import { HttpException } from '@nestjs/common';
import type { WalletErrorCode } from '@tanvion-royale/types';

export interface WalletErrorBody {
  statusCode: number;
  message: string;
  code: WalletErrorCode;
  details?: unknown;
}

/**
 * Throws a structured, client-safe wallet error whose `code` is surfaced by
 * the global AllExceptionsFilter. Never include secrets here.
 */
export function walletError(
  code: WalletErrorCode,
  message: string,
  status = 400,
  details?: unknown,
): never {
  const body: WalletErrorBody = {
    statusCode: status,
    message,
    code,
    ...(details !== undefined ? { details } : {}),
  };
  throw new HttpException(body, status);
}

/** True when the thrown error is a structured wallet error with this code. */
export function isWalletError(error: unknown, code: WalletErrorCode): boolean {
  return (
    error instanceof HttpException &&
    (error.getResponse() as Partial<WalletErrorBody>)?.code === code
  );
}
