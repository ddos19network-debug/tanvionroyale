import { HttpException } from '@nestjs/common';

/**
 * Client-safe, structured errors for the Royale Play games (Plinko + Mines).
 * Never include a seed, mine position, or any secret in these bodies.
 */
export type RoyaleErrorCode =
  | 'GAME_DISABLED'
  | 'REAL_MONEY_UNAVAILABLE'
  | 'VALIDATION_ERROR'
  | 'INVALID_STAKE'
  | 'INVALID_CONFIG'
  | 'INSUFFICIENT_POINTS'
  | 'ROUND_NOT_FOUND'
  | 'ROUND_NOT_ACTIVE'
  | 'ROUND_SETTLED'
  | 'ACTIVE_SESSION_EXISTS'
  | 'TILE_ALREADY_REVEALED'
  | 'DUPLICATE_REQUEST'
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'INTERNAL';

export interface RoyaleErrorBody {
  statusCode: number;
  message: string;
  code: RoyaleErrorCode;
  details?: unknown;
}

export function royaleError(
  code: RoyaleErrorCode,
  message: string,
  status = 400,
  details?: unknown,
): never {
  const body: RoyaleErrorBody = {
    statusCode: status,
    message,
    code,
    ...(details !== undefined ? { details } : {}),
  };
  throw new HttpException(body, status);
}

export function isRoyaleError(error: unknown, code: RoyaleErrorCode): boolean {
  return (
    error instanceof HttpException &&
    (error.getResponse() as Partial<RoyaleErrorBody>)?.code === code
  );
}