/**
 * Money amount in minor units (e.g. cents). Financial operations must
 * NEVER use floating-point arithmetic — always integer minor units.
 */
export type MinorUnit = number;

export interface Money {
  /**
   * Amount expressed in the smallest currency unit (e.g. cents).
   */
  amount: MinorUnit;
  currency: string; // ISO 4217 code, e.g. "BDT"
}

export interface MoneyRange {
  min: Money;
  max: Money;
}