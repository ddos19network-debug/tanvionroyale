import type { OperatorProviderInterface } from '@tanvion-royale/integrations';

/** DI token for the active betting provider (OperatorProviderInterface). */
export const BETTING_PROVIDER = Symbol('BETTING_PROVIDER');
export type { OperatorProviderInterface };