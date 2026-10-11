/**
 * Global AllExceptionsFilter — error-status correctness + safe response body.
 *
 * Guarantees under test:
 *  - Expected Prisma business errors map to meaningful statuses
 *    (P2025 -> 404, P2002 -> 409, P2003 -> 409) instead of a generic 500.
 *  - Unexpected failures remain 500 with a SAFE body (no stack traces, no
 *    internal details) and always carry a requestId.
 *  - HttpExceptions keep their status/message/code untouched.
 *  - A response that already has headers sent is never written twice.
 */
import { ArgumentsHost, BadRequestException, HttpException, HttpStatus } from '@nestjs/common';
import { Prisma } from '../src/generated/prisma';
import {
  AllExceptionsFilter,
  formatServerLogLine,
  sanitizeRouteForLog,
} from '../src/common/filters/all-exceptions.filter';

interface MockResponse {
  headersSent: boolean;
  headerValue: Record<string, string>;
  statusCodeArg?: number;
  bodyArg?: unknown;
  setHeader: (name: string, value: string) => MockResponse;
  status: (code: number) => MockResponse;
  json: (body: unknown) => MockResponse;
}

function makeHost(req: Record<string, unknown>, res: MockResponse): ArgumentsHost {
  return {
    switchToHttp: () =>
      ({
        getResponse: () => res,
        getRequest: () => req,
      }) as unknown as ArgumentsHost['switchToHttp'],
    switchToRpc: () => undefined as never,
    switchToWs: () => undefined as never,
    getType: () => 'http',
    getArgs: () => [] as never,
    getArgByIndex: () => undefined as never,
  } as unknown as ArgumentsHost;
}

function makeResponse(headersSent = false): MockResponse {
  const res: MockResponse = {
    headersSent,
    headerValue: {},
    setHeader(name, value) {
      res.headerValue[name] = value;
      return res;
    },
    status(code) {
      res.statusCodeArg = code;
      return res;
    },
    json(body) {
      res.bodyArg = body;
      return res;
    },
  };
  return res;
}

function prismaKnown(code: string, meta?: Record<string, unknown>): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('known', {
    code,
    clientVersion: 'test',
    meta,
  });
}

describe('AllExceptionsFilter', () => {
  const filter = new AllExceptionsFilter();
  const req = { method: 'GET', originalUrl: '/api/v1/admin/payment-methods', requestId: 'req-123' };

  it('keeps HttpException status/message/code and echoes the requestId', () => {
    const res = makeResponse();
    filter.catch(new BadRequestException('Payment method code is required'), makeHost(req, res));

    expect(res.statusCodeArg).toBe(400);
    expect(res.bodyArg).toMatchObject({
      statusCode: 400,
      message: 'Payment method code is required',
      code: 'VALIDATION_ERROR',
      requestId: 'req-123',
    });
    expect(res.headerValue['X-Request-Id']).toBe('req-123');
  });

  it('maps Prisma P2025 (record not found) to 404', () => {
    const res = makeResponse();
    filter.catch(prismaKnown('P2025'), makeHost(req, res));

    expect(res.statusCodeArg).toBe(HttpStatus.NOT_FOUND);
    expect(res.bodyArg).toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
  });

  it('maps Prisma P2002 (unique conflict) to 409 with safe field details', () => {
    const res = makeResponse();
    filter.catch(prismaKnown('P2002', { target: ['PaymentMethod_code_key'] }), makeHost(req, res));

    expect(res.statusCodeArg).toBe(HttpStatus.CONFLICT);
    expect(res.bodyArg).toMatchObject({
      statusCode: 409,
      code: 'CONFLICT',
      details: { fields: ['PaymentMethod_code_key'] },
    });
  });

  it('maps Prisma P2003 (FK violation) to 409', () => {
    const res = makeResponse();
    filter.catch(prismaKnown('P2003'), makeHost(req, res));

    expect(res.statusCodeArg).toBe(HttpStatus.CONFLICT);
  });

  it('keeps unexpected Prisma schema errors (P2021) as a safe 500', () => {
    const res = makeResponse();
    filter.catch(prismaKnown('P2021'), makeHost(req, res));

    expect(res.statusCodeArg).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(res.bodyArg).toMatchObject({
      statusCode: 500,
      message: 'Internal server error',
      code: 'INTERNAL_ERROR',
      requestId: 'req-123',
    });
    // The safe body must never contain a stack trace or internal message.
    expect(JSON.stringify(res.bodyArg)).not.toContain('stack');
  });

  it('keeps P2022 (missing column / pending migration) as a safe 500 with NO schema detail leaked', () => {
    // 2026-09-13 production incident: the deployed client queried
    // Session.previousRefreshTokenHash but the live Neon DB had no such column.
    // The failure must remain a 500 (it IS a server fault) — and the response
    // body must not leak the column/table or the internal message.
    const res = makeResponse();
    filter.catch(
      prismaKnown('P2022', { column: 'Session.previousRefreshTokenHash' }),
      makeHost(req, res),
    );

    expect(res.statusCodeArg).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(JSON.stringify(res.bodyArg)).not.toContain('Session');
    expect(JSON.stringify(res.bodyArg)).not.toContain('previousRefreshTokenHash');
    expect(JSON.stringify(res.bodyArg)).not.toContain('P2022');
  });

  it('returns a safe 500 for unknown exceptions and never leaks the message', () => {
    const res = makeResponse();
    const boom = new Error('Sensitive internals: connection string postgres://...');
    filter.catch(boom, makeHost(req, res));

    expect(res.statusCodeArg).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(res.bodyArg).toMatchObject({ statusCode: 500, message: 'Internal server error', requestId: 'req-123' });
    expect(JSON.stringify(res.bodyArg)).not.toContain('Sensitive internals');
    expect(JSON.stringify(res.bodyArg)).not.toContain('postgres://');
  });

  it('never writes to a response whose headers were already sent', () => {
    const res = makeResponse(true);
    filter.catch(new Error('boom'), makeHost(req, res));

    expect(res.statusCodeArg).toBeUndefined();
    expect(res.bodyArg).toBeUndefined();
  });

  it('generates a requestId when the middleware did not set one', () => {
    const res = makeResponse();
    filter.catch(new BadRequestException('x'), makeHost({ method: 'POST', originalUrl: '/x' }, res));

    const body = res.bodyArg as { requestId?: string };
    expect(typeof body.requestId).toBe('string');
    expect(body.requestId?.length).toBeGreaterThan(0);
  });
});

// Ensure HttpException import is used (keeps ts-jest isolatedModules happy).
void HttpException;

describe('formatServerLogLine (safe, complete server-side diagnostics)', () => {
  it('strips query strings so callback tokens and other query secrets never reach logs', () => {
    const route = sanitizeRouteForLog(
      '/api/v1/winhouse/balance-change?token=test-only-callback-token',
    );

    expect(route).toBe('/api/v1/winhouse/balance-change');
    expect(route).not.toContain('token=');
    expect(route).not.toContain('test-only-callback-token');
  });

  it('includes requestId, method, route, status and exception type', () => {
    const line = formatServerLogLine({
      requestId: 'req-xyz',
      method: 'POST',
      route: '/api/v1/auth/refresh',
      status: 500,
      exceptionType: 'PrismaClientKnownRequestError',
    });
    expect(line).toContain('[requestId=req-xyz]');
    expect(line).toContain('POST /api/v1/auth/refresh');
    expect(line).toContain('-> 500');
    expect(line).toContain('(PrismaClientKnownRequestError)');
  });

  it('explicitly records the Prisma error code for schema-drift 500s (grep target for Render logs)', () => {
    const line = formatServerLogLine({
      requestId: 'req-xyz',
      method: 'POST',
      route: '/api/v1/auth/refresh',
      status: 500,
      exceptionType: 'PrismaClientKnownRequestError',
      prismaCode: 'P2022',
      message: 'Column not found: Session.previousRefreshTokenHash',
    });
    expect(line).toContain('prismaCode=P2022');
    expect(line).toContain('Column not found');
  });

  it('includes the authenticated user id when known', () => {
    const line = formatServerLogLine({
      requestId: 'req-xyz',
      method: 'GET',
      route: '/api/v1/auth/me',
      status: 500,
      exceptionType: 'Error',
      userId: 'u-42',
    });
    expect(line).toContain('user=u-42');
  });

  it('does not fabricate any parameter that was not provided', () => {
    const line = formatServerLogLine({
      requestId: 'req-xyz',
      method: 'POST',
      route: '/api/v1/auth/oauth/exchange',
      status: 400,
      exceptionType: 'BadRequestException',
    });
    expect(line).not.toContain('prismaCode=');
    expect(line).not.toContain('user=');
  });
});