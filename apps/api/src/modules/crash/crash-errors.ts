import { HttpException } from '@nestjs/common';

/** Client-safe, structured errors for the crash game engine. */
export type CrashErrorCode =
  | 'GAME_DISABLED'
  | 'REAL_MONEY_UNAVAILABLE'
  | 'VALIDATION_ERROR'
  | 'ROUND_NOT_FOUND'
  | 'ROUND_NOT_ACTIVE'
  | 'BETTING_CLOSED'
  | 'BETTING_NOT_OPEN'
  | 'INVALID_STAKE'
  | 'INSUFFICIENT_POINTS'
  | 'BET_NOT_FOUND'
  | 'BET_NOT_YOURS'
  | 'BET_NOT_ACTIVE'
  | 'ALREADY_CASHED_OUT'
  | 'ROUND_CRASHED'
  | 'DUPLICATE_REQUEST'
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'INVALID_BET_STATE'
  | 'INTERNAL';

export interface CrashErrorBody {
  statusCode: number;
  message: string;
  code: CrashErrorCode;
  details?: unknown;
}

export function crashError(
  code: CrashErrorCode,
  message: string,
  status = 400,
  details?: unknown,
): never {
  const body: CrashErrorBody = {
    statusCode: status,
    message,
    code,
    ...(details !== undefined ? { details } : {}),
  };
  throw new HttpException(body, status);
}

export function isCrashError(error: unknown, code: CrashErrorCode): boolean {
  return (
    error instanceof HttpException &&
    (error.getResponse() as Partial<CrashErrorBody>)?.code === code
  );
}