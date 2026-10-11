import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';

/**
 * Deterministic odds & payout helpers.
 *
 * Odds are decimal STRINGS (e.g. "1.85"). To avoid any floating-point risk we
 * treat them as an integer fraction: "1.85" => 185 / 100. A potential return is
 * then computed with pure integer arithmetic:
 *
 *   potentialReturn(minorUnits) = floor(stake * numerator / denominator)
 *
 * e.g. stake = 1000 (10.00 BDT) at "1.85" => floor(1000 * 185 / 100) = 1850.
 *
 * Invalid odds are a client/data problem (400), never a generic 500: the
 * global filter maps BadRequestException to HTTP 400 with a safe message.
 */
/** Thrown (400) when an odds price string is malformed — never a generic 500. */
export function invalidOdds(price: string): never {
  throw new BadRequestException(`Invalid odds price: ${price}`);
}

/** Thrown (503) when the market-data provider is unavailable — fail-safe. */
export function marketDataUnavailable(detail?: string): never {
  throw new ServiceUnavailableException(detail ?? 'Market data provider is temporarily unavailable');
}

export interface ParsedOdds {
  numerator: number;
  denominator: number;
}

export function parseOdds(price: string): ParsedOdds {
  if (!/^\d+(\.\d{1,2})?$/.test(price)) {
    throw new BadRequestException(`Invalid odds price: ${price}`);
  }
  const [whole, fraction = ''] = price.split('.');
  const scale = fraction.length;
  const numerator = Number(whole) * 10 ** scale + Number(fraction || '0');
  const denominator = 10 ** scale;
  return { numerator, denominator };
}

export function calculatePotentialReturn(stakeMinorUnits: number, price: string): number {
  const { numerator, denominator } = parseOdds(price);
  return Math.floor((stakeMinorUnits * numerator) / denominator);
}