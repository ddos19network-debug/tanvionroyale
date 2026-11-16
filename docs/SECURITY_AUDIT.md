# TANVIONROYALE — Security Audit & Controls
**Audit Date:** 2026-11-14

---

## 1. Authentication & Session Security

- **Password Hashing**: Implemented via Argon2id with memory cost and parallelization configured in `apps/api/src/modules/auth/argon.service.ts`.
- **Token Security**:
  - Short-lived Access Tokens (JWT) signed with secret HMAC/RSA.
  - Refresh token rotation with SHA-256 hash storage (`Session.previousRefreshTokenHash`) to prevent replay attacks.
  - Revocation of all active sessions on password change or manual user revocation.
- **Rate Limiting**:
  - Throttler module active on authentication endpoints (`/auth/login`, `/auth/register`, `/auth/request-otp`).
  - Brute-force protection verified via `test/auth.spec.ts`.

---

## 2. Financial Ledger & Transaction Controls

- **Double-Entry Verification**: All balance updates require corresponding `LedgerEntry` and `WalletTransaction` records inside transactional blocks.
- **Idempotency Keys**: Deposit and withdrawal submissions enforce unique idempotency identifiers to prevent duplicate billing from network retries.
- **Withdrawal Approvals**: Two-tier withdrawal workflow. Funds are placed into `frozenBalance` upon request, requiring manual admin review before disbursement.
- **Provider Callbacks & Webhooks**:
  - HMAC-SHA256 signature verification on partner callbacks (`BigBang`, `WinHouse`).
  - Raw body verification ensuring webhook payloads are not tampered with.

---

## 3. Data Protection & Leak Prevention

- **Error Sanitization**: `AllExceptionsFilter` masks Prisma internals, SQL queries, and database connection strings, responding with standard safe JSON error objects.
- **CORS & Headers**: Helmet security headers configured (CSP, HSTS, frameguard, XSS filter, noSniff).
- **Client-Side Storage**: Sensitive tokens stored securely with HTTP-only cookies where applicable and transient memory caches.
