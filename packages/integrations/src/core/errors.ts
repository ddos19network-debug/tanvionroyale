export type OperatorErrorCode =
  | 'UNAUTHORIZED'
  | 'PROVIDER_UNAVAILABLE'
  | 'TIMEOUT'
  | 'INVALID_REQUEST'
  | 'BET_REJECTED'
  | 'BET_SUSPENDED'
  | 'ODDS_CHANGED'
  | 'KYC_REQUIRED'
  | 'LIMIT_EXCEEDED'
  | 'RESPONSIBLE_GAMBLING_BLOCKED'
  | 'NOT_FOUND';

/**
 * Typed error surfaced from the operator integration layer.
 * Keeps provider-specific failure details inside this package.
 */
export class OperatorError extends Error {
  constructor(
    public readonly code: OperatorErrorCode,
    message: string,
    public readonly provider?: string,
    public readonly providerRequestId?: string,
    public readonly exposeToClient = true,
  ) {
    super(message);
    this.name = 'OperatorError';
  }
}