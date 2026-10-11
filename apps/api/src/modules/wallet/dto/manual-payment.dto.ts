import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * Currencies currently supported by the wallet/deposit system.
 */
export const MANUAL_PAYMENT_CURRENCIES = [
  'BDT',
  'USD',
  'EUR',
] as const;

export type ManualPaymentCurrency =
  (typeof MANUAL_PAYMENT_CURRENCIES)[number];

/**
 * Manual deposit submission.
 *
 * The user must provide AT LEAST ONE proof — never both:
 * - transaction/reference ID only  → accepted
 * - screenshot only                 → accepted
 * - both                            → accepted
 * - neither                         → rejected by the service
 *
 * Neither field carries a "required" validator here: making either one
 * required at DTO level is exactly the bug that forced users to supply both.
 * The combined rule is enforced by ManualPaymentService.submitManualDeposit.
 */
export class SubmitManualDepositDto {
  /**
   * Payment method code.
   *
   * Examples:
   * bkash
   * nagad
   * rocket
   * bank
   * card
   */
  @IsString()
  @MinLength(2)
  @MaxLength(32)
  methodCode!: string;

  /**
   * Deposit currency.
   */
  @IsString()
  @IsIn(MANUAL_PAYMENT_CURRENCIES)
  currency!: ManualPaymentCurrency;

  /**
   * Amount in the smallest wallet unit.
   *
   * Example:
   * 1000 = 1000 BDT
   * 10 = 10 USD
   *
   * The exact display/decimal handling is performed
   * by the wallet layer.
   */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100_000_000)
  amount!: number;

  /**
   * Transaction/reference ID.
   *
   * OPTIONAL on its own: a screenshot alone is a complete submission.
   * The minimum length is enforced by the service (only when a value is
   * actually supplied) so that a blank/whitespace value falls through to the
   * clear "transaction ID or screenshot" message instead of a raw
   * class-validator length error.
   */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  referenceId?: string;

  /**
   * Payment screenshot.
   *
   * OPTIONAL on its own: a transaction ID alone is a complete submission.
   *
   * For now the frontend can send an image data URL.
   * The service validates that it is an image and
   * limits its size before saving it.
   */
  @IsOptional()
  @IsString()
  @MaxLength(2_500_000)
  proofDataUrl?: string;

  /**
   * Client-generated idempotency key.
   *
   * Prevents duplicate submissions if the user taps
   * the Submit button more than once or the request
   * is retried.
   */
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(100)
  idempotencyKey?: string;
}

/**
 * User-facing payment-method query.
 */
export class ListPaymentMethodsQueryDto {
  /**
   * Only methods supporting this currency are returned.
   */
  @IsOptional()
  @IsString()
  @IsIn(MANUAL_PAYMENT_CURRENCIES)
  currency?: ManualPaymentCurrency;

  /**
   * Payment purpose.
   */
  @IsOptional()
  @IsIn([
    'deposit',
    'withdrawal',
  ])
  purpose?: 'deposit' | 'withdrawal';
}

/**
 * Admin manual-deposit list query.
 */
export class AdminListManualDepositsQueryDto {
  @IsOptional()
  @IsIn([
    'PENDING',
    'UNDER_REVIEW',
    'APPROVED',
    'REJECTED',
    'CANCELLED',
  ])
  status?:
    | 'PENDING'
    | 'UNDER_REVIEW'
    | 'APPROVED'
    | 'REJECTED'
    | 'CANCELLED';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

/**
 * Admin review action.
 */
export class AdminReviewManualDepositDto {
  @IsIn([
    'APPROVE',
    'REJECT',
  ])
  action!: 'APPROVE' | 'REJECT';

  /**
   * Required/recommended when rejecting a request.
   */
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason?: string;
}
