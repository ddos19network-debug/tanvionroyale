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
  | 'INTERNAL'
  // REAL_MONEY eligibility gate (Task 1 / audit F1, F2, F4). Every one of these
  // is thrown BEFORE any wallet reservation and always with HTTP 403.
  | 'ROYALE_ACCOUNT_NOT_ACTIVE'
  | 'ROYALE_KYC_REQUIRED'
  | 'ROYALE_AGE_RESTRICTED'
  | 'ROYALE_SELF_EXCLUDED'
  | 'ROYALE_LIMIT_EXCEEDED'
  // Central jurisdiction & currency control + kill switches (PART A). Thrown
  // before any wallet reservation, always with HTTP 403.
  | 'ROYALE_MASTER_SWITCH_OFF'
  | 'ROYALE_GAME_SWITCH_OFF'
  | 'ROYALE_JURISDICTION_BLOCKED';

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