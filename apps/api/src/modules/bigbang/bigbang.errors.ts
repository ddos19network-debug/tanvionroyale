import { HttpException } from '@nestjs/common';

export type BigBangRefusalCode =
  | 'BIGBANG_NOT_CONFIGURED'
  | 'BIGBANG_BAD_API_KEY'
  | 'BIGBANG_MALFORMED_BODY'
  | 'BIGBANG_MISSING_SIGNATURE'
  | 'BIGBANG_BAD_SIGNATURE'
  | 'BIGBANG_INVALID_AMOUNT'
  | 'BIGBANG_UNKNOWN_PLAYER'
  | 'BIGBANG_CURRENCY_MISMATCH'
  | 'BIGBANG_TRANSACTION_CONFLICT'
  | 'BIGBANG_INSUFFICIENT_FUNDS'
  | 'BIGBANG_UNAVAILABLE';

export function bigbangRefuse(
  status: 400 | 401 | 404 | 409 | 422 | 503,
  code: BigBangRefusalCode,
  message: string,
): never {
  throw new HttpException({ error: message, code }, status);
}
