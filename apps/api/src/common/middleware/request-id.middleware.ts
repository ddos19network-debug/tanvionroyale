import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Stable per-request correlation ID (echoed back as X-Request-Id). */
      requestId?: string;
    }
  }
}

/**
 * Assigns a stable per-request correlation ID used by the global
 * AllExceptionsFilter (and available to every downstream component):
 *
 *  - Honors an incoming `X-Request-Id` from trusted fronting proxies when it is
 *    a safe token (alnum, dash, dot, underscore, <= 64 chars) so distributed
 *    traces can be correlated end-to-end.
 *  - Otherwise generates a fresh UUID. The value is echoed back on every
 *    response as `X-Request-Id`.
 *
 * No request bodies, secrets or credentials are ever read or logged here.
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.headers['x-request-id'];
    const safe =
      typeof incoming === 'string' &&
      incoming.length > 0 &&
      incoming.length <= 64 &&
      /^[A-Za-z0-9._-]+$/.test(incoming);

    const requestId = safe ? incoming : randomUUID();
    req.requestId = requestId;
    res.setHeader('X-Request-Id', requestId);
    next();
  }
}