# TANVIONROYALE — SECURITY AUDIT
**Phase:** Phase 3: Core Application Development  
**Date:** November 2026  
**Status:** Passed — Institutional Compliance Verified  

---

## 1. Authentication & Authorization

### JWT Token Security
- All sensitive endpoints are guarded by `JwtAuthGuard` extracting user claims from cryptographically signed JWT tokens.
- Token expiration enforced with rotation mechanisms via secure refresh endpoints.
- User status checks (`ACTIVE`, `SUSPENDED`, `LOCKED`, `BANNED`) verified on every authenticated request in `SessionAuthService`. Suspended/locked accounts are blocked from placing orders, depositing, or withdrawing.

### Role-Based Access Control (RBAC)
- Administrative routes (`/admin/*` and `/api/v1/admin/*`) require explicit `ADMIN` role validation through `RolesGuard`.
- Standard user tokens cannot access administrative functions, preventing privilege escalation.
- Backend permission checks (`PermissionGuard`) ensure fine-grained permissions for support, financial, and operational tasks.

---

## 2. Financial Integrity & Anti-Fraud Controls

### Server-Authoritative Balance Enforcement
- The client is strictly an interface: client-side balances, fees, or amounts are never trusted.
- Balances are stored in integer minor units (e.g. cents/poisha) to eliminate floating-point rounding inaccuracies.
- Negative balances are strictly rejected at the database level with balance check constraints.

### Double-Entry Ledger Consistency
- Every deposit, withdrawal, and adjustment writes matching debit and credit entries to `LedgerEntry` inside an ACID PostgreSQL transaction (`prisma.$transaction`).
- Advisory locks prevent race conditions during concurrent balance deductions.

### Withdrawal Fund Reservation Lifecycle
1. User requests withdrawal for amount `A`.
2. System validates `availableBalance >= A`.
3. System atomically moves `A` from `availableBalance` to `lockedBalance` and creates `WithdrawalRequest` with status `PENDING`.
4. If Admin approves: `lockedBalance` is decremented by `A`, status updated to `COMPLETED`, audit log recorded.
5. If Admin rejects: `lockedBalance` is decremented by `A` and restored to `availableBalance`, status updated to `REJECTED`, rejection reason provided.

### Idempotency Protection
- All financial submissions require an `idempotencyKey` UUID. Replay attacks and duplicate submissions result in early rejection without double-crediting.

---

## 3. Privacy, Sensitive Data & Injection Protection
- Passwords hashed using Argon2 / bcrypt with high work factors.
- SQL injection prevented through Prisma ORM parameterized query generation.
- XSS protection through React DOM JSX text auto-escaping and Next.js security headers.
- CORS policies strictly restrict cross-origin access to authorized platform domains.
