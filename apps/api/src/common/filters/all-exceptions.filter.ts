import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '../../generated/prisma';
import { scrubPhoneFromMessage } from '../utils/phone';
import type { Response } from 'express';

/**
 * Global exception filter that formats every error into the project's standard
 * response body while ADDING a stable, structured `code` for programmatic
 * handling (the existing `statusCode` / `message` / `error` fields are kept so
 * nothing breaks). Business errors thrown with a `{ code, message, details }`
 * body (see modules/betting/betting-errors) surface their code verbatim.
 *
 * Phase 5/26 requirements implemented here:
 *  - Every response carries a `requestId`; the same ID is written to the server
 *    log together with method + route + status + exception type so any
 *    unexpected 500 is traceable without exposing secrets or stack traces to
 *    clients.
 *  - Expected Prisma business errors are mapped to meaningful statuses
 *    (P2025 -> 404, P2002 -> 409, P2003 -> 409). Unexpected database failures
 *    (P2021/P2022 schema drift, connection loss, ...) remain 500 but are
 *    logged safely with full server-side context.
 */
function defaultCodeForStatus(status: number): string {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
      return 'VALIDATION_ERROR';
    case HttpStatus.UNAUTHORIZED:
      return 'UNAUTHORIZED';
    case HttpStatus.FORBIDDEN:
      return 'FORBIDDEN';
    case HttpStatus.NOT_FOUND:
      return 'NOT_FOUND';
    case HttpStatus.CONFLICT:
      return 'CONFLICT';
    case HttpStatus.TOO_MANY_REQUESTS:
      return 'RATE_LIMITED';
    case HttpStatus.UNPROCESSABLE_ENTITY:
      return 'UNPROCESSABLE_ENTITY';
    default:
      return 'ERROR';
  }
}

interface PrismaMappedError {
  status: number;
  message: string;
  code: string;
  /** Unique-constraint field names (schema metadata only — never row data). */
  conflictFields?: string[];
}

export interface ServerLogContext {
  requestId: string;
  method: string;
  route: string;
  status: number;
  exceptionType: string;
  message?: string;
  /** Prisma known-request error code (e.g. P2022) — the fastest way to spot schema drift. */
  prismaCode?: string;
  /** Authenticated user id when the request carried one (never a token). */
  userId?: string;
  /**
   * Rejected field names (e.g. `["phone","password"]`) when the failure was a
   * request-shape/validation rejection. This is what turns the production
   * "400 BadRequestException" with no explanation into an actionable line.
   * NAMES ONLY — never values, so a phone/OTP/password can never leak.
   */
  invalidFields?: string[];
  /**
   * How the failure was produced: `validation` (the global ValidationPipe
   * rejected the body/query) vs `explicit` (a service threw a business
   * BadRequestException on purpose). Lets an operator tell "the client sent
   * junk" from "our rule rejected it" without reading the whole payload.
   */
  errorKind?: 'validation' | 'explicit' | 'system';
}

/** Removes query/fragment data from a route before it reaches any server log. */
export function sanitizeRouteForLog(route: string | undefined): string {
  if (!route) return '?';
  const boundary = route.search(/[?#]/);
  return boundary === -1 ? route : route.slice(0, boundary);
}

/**
 * Builds the single-line SERVER-SIDE log entry for a handled exception.
 *
 * Safe by construction: composed ONLY from request metadata, status, exception
 * type/message and (when present) the Prisma error code + user id. Never
 * request bodies, credentials, tokens or secrets.
 *
 * Kept as a pure function so the exact diagnostics are unit-testable without
 * instantiating a Nest logger or an HTTP context.
 */
export function formatServerLogLine(ctx: ServerLogContext): string {
  const parts = [
    `[requestId=${ctx.requestId}]`,
    `${ctx.method} ${ctx.route}`,
    `-> ${ctx.status}`,
    `(${ctx.exceptionType})`,
  ];
  if (ctx.prismaCode) parts.push(`prismaCode=${ctx.prismaCode}`);
  if (ctx.userId) parts.push(`user=${ctx.userId}`);
  // Diagnostics that make a bare "400 BadRequestException" actionable. Field
  // NAMES only and phone-shaped text masked, so this stays safe to log.
  if (ctx.errorKind) parts.push(`kind=${ctx.errorKind}`);
  if (ctx.invalidFields?.length) parts.push(`fields=${ctx.invalidFields.join(',')}`);
  if (ctx.message) parts.push(ctx.message);
  return parts.join(' ');
}

/**
 * Extracts the rejected FIELD NAMES from a class-validator message array
 * (e.g. `["phone must be a valid E.164 number"]` -> `["phone"]`).
 *
 * Only the leading token of each message is kept, and it is reduced to a
 * conservative identifier charset, so no user-supplied value can ride along in
 * a log line. The raw message text itself is NEVER returned here.
 */
export function extractInvalidFieldNames(messages: unknown): string[] {
  if (!Array.isArray(messages)) return [];
  const names: string[] = [];
  for (const entry of messages) {
    if (typeof entry !== 'string') continue;
    const first = entry.trim().split(/\s+/)[0] ?? '';
    const name = first.replace(/[^A-Za-z0-9_$.[\]]/g, '').replace(/[.[\]]+$/, '');
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

/**
 * Maps EXPECTED Prisma request errors to meaningful client responses. The
 * messages are generic on purpose: they describe the outcome, never internal
 * identifiers or query text.
 */
function mapPrismaKnownError(
  code: string,
  error: Prisma.PrismaClientKnownRequestError,
): PrismaMappedError | null {
  switch (code) {
    case 'P2025': // record not found
      return {
        status: HttpStatus.NOT_FOUND,
        message: 'The requested resource was not found.',
        code: 'NOT_FOUND',
      };
    case 'P2002': {
      // unique constraint violation
      const target = error.meta?.target;
      return {
        status: HttpStatus.CONFLICT,
        message: 'This record already exists or conflicts with another record.',
        code: 'CONFLICT',
        conflictFields:
          Array.isArray(target) && target.every((f) => typeof f === 'string')
            ? (target as string[])
            : undefined,
      };
    }
    case 'P2003': // foreign key constraint violation
      return {
        status: HttpStatus.CONFLICT,
        message: 'This operation conflicts with a related record.',
        code: 'CONFLICT',
      };
    default:
      // P2021/P2022 (schema drift), connection loss, ... are genuine server
      // faults and must stay 500 — never masked as a client error.
      return null;
  }
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<{
      method?: string;
      originalUrl?: string;
      requestId?: string;
      routerPath?: string;
      user?: { id?: unknown } | null;
    }>();

    // A response may already be on the wire for this request (e.g. a handler
    // already called res.redirect()/res.send(), an interceptor attempted a
    // second write after the handler returned, or the client stream was
    // flushed). Writing to such a response throws ERR_HTTP_HEADERS_SENT, and
    // because this filter runs inside the router proxy's catch block, that
    // throw escapes as an unhandled rejection and kills the entire Node
    // process. Nest's recommended pattern: if headers are already sent, log
    // the exception and bail out — never attempt another write.
    if (response.headersSent) {
      this.logger.error(
        `Exception raised after response was already sent for this request (headersSent=true); skipping response write. ` +
          `${exception instanceof Error ? exception.stack : String(exception)}`,
      );
      return;
    }

    const requestId = request.requestId ?? randomUUID();
    const method = request.method ?? '?';
    const route = sanitizeRouteForLog(request.originalUrl ?? request.routerPath);

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let payload: Record<string, unknown> & { statusCode: number };
    /**
     * Field names the global ValidationPipe rejected (empty for every other
     * failure). The production phone-signup 400 was a bare
     * "BadRequestException / Bad Request Exception" because this information
     * was thrown away; it is what makes such a line greppable.
     */
    let invalidFields: string[] = [];

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();

      if (typeof res === 'string') {
        payload = {
          statusCode: status,
          message: res,
          error: '',
          code: defaultCodeForStatus(status),
          requestId,
        };
      } else {
        const obj = res as Record<string, unknown>;
        const message =
          typeof obj.message === 'string'
            ? obj.message
            : Array.isArray(obj.message)
              ? obj.message.join(', ')
              : String(obj.error ?? 'Request failed');

        // A class-validator rejection arrives as an ARRAY of messages, one per
        // broken field. Recovering the field NAMES here is what turns the
        // production "400 BadRequestException" into "fields=phone".
        if (Array.isArray(obj.message)) {
          invalidFields = extractInvalidFieldNames(obj.message);
        }

        payload = {
          statusCode: status,
          message,
          error: (obj.error as string) ?? '',
          code: (obj.code as string) ?? defaultCodeForStatus(status),
          requestId,
        };
        if (obj.details !== undefined) {
          payload.details = obj.details;
        }
      }
    } else {
      const isPrismaKnown = exception instanceof Prisma.PrismaClientKnownRequestError;
      const mapped = isPrismaKnown
        ? mapPrismaKnownError(exception.code, exception)
        : null;

      if (mapped) {
        status = mapped.status;
        payload = {
          statusCode: status,
          message: mapped.message,
          error: '',
          code: mapped.code,
          requestId,
        };
        if (mapped.conflictFields?.length) {
          payload.details = { fields: mapped.conflictFields };
        }
      } else {
        // Unexpected failure: 500 with a SAFE body. The full context (stack,
        // exception type, message) goes to the server log only — never to the
        // client, never containing credentials or request bodies.
        payload = {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Internal server error',
          error: 'InternalServerError',
          code: 'INTERNAL_ERROR',
          requestId,
        };
      }
    }

    // ---- Server-side observability (safe: no secrets, no bodies) ----
    const exceptionName =
      exception instanceof Error ? exception.name : typeof exception;
    const safeMessage =
      exception instanceof Error ? exception.message : String(exception);
    // Explicit Prisma code (P2021/P2022 = schema drift, P2002/P2003/P2025 =
    // mapped business errors, ...) so Render logs are greppable without
    // relying on the message text. Never logs the failing query VALUES.
    const prismaCode =
      exception instanceof Prisma.PrismaClientKnownRequestError ? exception.code : undefined;
    // Authenticated user id when known (JwtAuthGuard attaches request.user).
    const requestUserId =
      request.user && typeof request.user.id === 'string' ? request.user.id : undefined;
    const logLine = formatServerLogLine({
      requestId,
      method,
      route,
      status,
      exceptionType: exceptionName,
      // Any phone-shaped text is masked before it reaches a log line, so a
      // message that quotes a number can never expose it.
      message: scrubPhoneFromMessage(safeMessage),
      prismaCode,
      userId: requestUserId,
      invalidFields,
      errorKind: invalidFields.length
        ? 'validation'
        : exception instanceof HttpException
          ? 'explicit'
          : 'system',
    });

    if (status >= 500) {
      // Unexpected server fault: log the full stack trace server-side.
      this.logger.error(
        logLine,
        exception instanceof Error ? exception.stack : undefined,
      );
    } else {
      // Expected client errors are logged as warnings without a stack.
      this.logger.warn(logLine);
    }

    response.setHeader('X-Request-Id', requestId);
    response.status(status).json(payload);
  }
}