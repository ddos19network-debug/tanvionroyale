import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import {
  TRUSTED_GEO_COUNTRY_HEADER,
  runWithTrustedGeoCountry,
} from '../geo/trusted-geo';

/**
 * Captures the trusted edge geo country ONCE per request and propagates it to
 * the whole downstream async chain (services included) through
 * AsyncLocalStorage, so RoyaleEligibilityService can read it without every
 * service method having to thread a `headers` argument through.
 *
 * The value is normalized (ISO-3166-1 alpha-2 only). An absent/garbage header
 * becomes `null` — which the jurisdiction gate treats as UNKNOWN => BLOCKED.
 * No other header, body or query value is ever read here.
 */
@Injectable()
export class TrustedGeoMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction): void {
    const raw = req.headers[TRUSTED_GEO_COUNTRY_HEADER];
    const header = Array.isArray(raw) ? raw[0] : raw;
    runWithTrustedGeoCountry(header ?? null, () => next());
  }
}
