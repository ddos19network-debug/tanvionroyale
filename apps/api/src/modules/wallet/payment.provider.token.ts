import type {
  DepositProviderInterface,
  WithdrawalProviderInterface,
} from '@tanvion-royale/integrations';

/** DI token for the active deposit provider (DepositProviderInterface). */
export const DEPOSIT_PROVIDER = Symbol('DEPOSIT_PROVIDER');
/** DI token for the active withdrawal provider (WithdrawalProviderInterface). */
export const WITHDRAWAL_PROVIDER = Symbol('WITHDRAWAL_PROVIDER');
export type { DepositProviderInterface, WithdrawalProviderInterface };
