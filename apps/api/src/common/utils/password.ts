import * as argon2 from 'argon2';

/**
 * Password hashing — argon2id, the ONE scheme every password in the system
 * uses (customer signup, ADMIN-created staff, master-admin bootstrap).
 *
 * Exists so the database scripts inside the API workspace (e.g.
 * bootstrap-master-admin.ts) hash with exactly the same algorithm without
 * reaching into API internals. The API's existing call sites keep their inline
 * argon2 calls — this is not a refactor of them.
 */
export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}
