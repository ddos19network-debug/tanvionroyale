import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { ApiResponse } from '@tanvion-royale/types';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { SKIP_RESPONSE_ENVELOPE_KEY } from '../decorators/skip-response-envelope.decorator';

/**
 * Wraps successful responses in the standard ApiResponse envelope so the
 * frontend always receives a stable, inspectable shape.
 *
 * A route decorated with @SkipResponseEnvelope() is deliberately exempt: its
 * body IS an external provider's documented wire contract (WinHouse seamless
 * wallet callbacks) and wrapping it would make the provider read an applied
 * movement as "in doubt" and retry it. The opt-out is per route, so no other
 * endpoint changes.
 */
@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, ApiResponse<T> | T> {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler<T>): Observable<ApiResponse<T> | T> {
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_RESPONSE_ENVELOPE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) return next.handle();

    return next.handle().pipe(map((data) => ({ success: true, data }) as ApiResponse<T>));
  }
}