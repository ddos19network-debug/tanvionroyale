import { createHmac, timingSafeEqual } from 'node:crypto';

/** Exact BigBang callback signature: no separators, amount exactly as sent. */
export interface BigBangHmacFields {
  username: string;
  amount: string;
  game: string;
  game_category: string;
  transaction_id: string;
}

export function buildBigBangHmac(apiKey: string, fields: BigBangHmacFields): string {
  const message = `${fields.username}${fields.amount}${fields.game}${fields.game_category}${fields.transaction_id}`;
  return createHmac('sha256', apiKey).update(message, 'utf8').digest('hex');
}

export function verifyBigBangHmac(
  apiKey: string | null | undefined,
  fields: BigBangHmacFields,
  suppliedSignature: string | null | undefined,
): boolean {
  if (!apiKey || !suppliedSignature) return false;
  const supplied = suppliedSignature.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(supplied)) return false;
  const expected = buildBigBangHmac(apiKey, fields);
  const suppliedBytes = Buffer.from(supplied, 'hex');
  const expectedBytes = Buffer.from(expected, 'hex');
  return suppliedBytes.length === expectedBytes.length && timingSafeEqual(suppliedBytes, expectedBytes);
}

/** Constant-time X-API-Key comparison used by BigBang callbacks. */
export function verifyBigBangApiKey(
  suppliedKey: string | null | undefined,
  expectedKey: string | null | undefined,
): boolean {
  if (!suppliedKey || !expectedKey) return false;
  const supplied = Buffer.from(suppliedKey, 'utf8');
  const expected = Buffer.from(expectedKey, 'utf8');
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

