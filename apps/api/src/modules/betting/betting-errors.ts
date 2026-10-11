import { HttpException } from '@nestjs/common';
import type { BettingErrorCode } from '@tanvion-royale/types';

export interface BettingErrorBody {
  statusCode: number;
  message: string;
  code: BettingErrorCode;
  details?: unknown;
}

/**
 * Throws a structured, client-safe betting error whose `code` is surfaced by
 * the global AllExceptionsFilter. Never include secrets here.
 */
export function bettingError(
  code: BettingErrorCode,
  message: string,
  status = 400,
  details?: unknown,
): never {
  const body: BettingErrorBody = {
    statusCode: status,
    message,
    code,
    ...(details !== undefined ? { details } : {}),
  };
  throw new HttpException(body, status);
}