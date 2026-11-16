# TANVIONROYALE — SECURITY AUDIT

## 1. AUTHENTICATION AND AUTHORIZATION

### 1.1 Authentication
- JWT Bearer Token — Used for all authenticated API requests
- AuthGuard — NestJS guard validating token on protected routes
- PublicGuard — Allows anonymous access where needed (login, register, public pages)
- Token lifecycle — Access tokens with refresh mechanism via POST /auth/refresh
- Session management — Token revocation on POST /auth/logout

### 1.2 Authorization (RBAC)
- RoleName enum: SUPER_ADMIN, ADMIN, FINANCE, SUPPORT, COMPLIANCE, CONTENT_MANAGER, ANALYST
- Permission system — Admin model has JSON permissions field for fine-grained control
- Role-based endpoints — Different endpoints accessible based on role
- Staff vs customer separation — Staff accounts have no customer wallet domain

## 2. INPUT VALIDATION

### 2.1 DTO Validation
- All input DTOs use @nestjs/class-validator and @nestjs/class-transformer
- Zod schemas in packages/validation/ for complex validation scenarios
- Idempotency key validation for financial requests (userId + idempotencyKey unique constraint)

### 2.2 Financial Input Validation
- assertAmountInRange() — Validates withdrawal amounts are within permitted range
- Currency normalization — normalizeCurrency() ensures uppercase, trimmed currency codes
- Supported currencies: BDT, USD, EUR (from WALLET_CURRENCIES in types package)
- Amount precision — All monetary amounts as integer minor units (cents)

## 3. RATE LIMITING

- Per-endpoint rate limiting configured
- Financial endpoints (wallet, withdrawal) have stricter limits
- Authentication endpoints have appropriate throttling
- Export protection to prevent API abuse

## 4. SECURE SECRET MANAGEMENT

### 4.1 API Key/Secret Storage
- Provider credentials stored encrypted at rest
- apiKeyEnc and apiSecretEnc fields in Provider model (AES-256-GCM encrypted)
- Never store raw API keys or secrets
- authMode field controls authentication method (api-key | basic | none)
- environment field gates sandbox vs live (sandbox and live are NEVER mixed)

### 4.2 Encryption Key Management
- AES-256-GCM encryption at rest
- Secrets never exposed in API responses
- Environment variables for database connection only (DATABASE_URL)
- No hardcoded credentials in source code

## 5. XSS AND INJECTION PREVENTION

### 5.1 XSS Protection
- No dangerouslySetInnerHTML used in critical areas
- User-generated content sanitized where displayed
- Content Security Policy headers configured
- Input sanitization on any data displayed on frontend

### 5.2 SQL Injection Prevention
- Prisma ORM used exclusively for all database queries — eliminates manual SQL construction
- Parameterized queries through Prisma client
- No raw SQL queries in production code
- Migration scripts use Prisma schema, not raw SQL

### 5.3 No SQL Injection Risks Observed
- All database operations go through Prisma client
- No string concatenation for query construction
- Safe by framework design

## 6. FINANCIAL TRANSACTION INTEGRITY

### 6.1 Core Principles
- Backend is source of truth — Never trust frontend-provided balances, fees, or transaction statuses
- Ledger-based accounting — Every balance change has corresponding ledger entry
- Idempotency protection — (userId, idempotencyKey) uniqueness prevents duplicate transactions
- Transactions for financial operations — Wallet operations use Prisma $transaction() for atomicity

### 6.2 Withdrawal Security Flow (from withdrawal.service.ts)
1. Idempotency check — Repeat request returns original transaction, never creates duplicate
2. Reserve funds atomically — availableBalance -= amount, lockedBalance += amount under row lock
3. Provider call — Delegated to configured provider (dev mock in development mode)
4. Status-based handling:
   - SUCCESS → lockedBalance -= amount; funds leave wallet
   - FAILED → lockedBalance -= amount, availableBalance += amount; release funds
   - PENDING/PROCESSING → Keep reserved; await webhook confirmation
5. Never complete without confirmation — PENDING/PROCESSING stays reserved until webhook settles

### 6.3 Deposit Security
- Deposit status must come from backend verification, not frontend acknowledgment
- Webhook from provider confirms completion
- Pending deposits not considered complete until verified

### 6.4 Forbidden Practices (Do Not Do)
- Do not trust frontend-provided balances
- Do not trust frontend-provided transaction statuses
- Do not directly modify balances without corresponding ledger transactions
- Do not bypass idempotency protection for financial requests
- Do not enable real-money trading without required approvals

## 7. SESSION AND DEVICE SECURITY

### 7.1 Active Sessions
- Session tracking exists in database schema
- Users can view active sessions
- "Logout other sessions" functionality should be implemented

### 7.2 Login History
- Login history logging exists
- Device management should be available to users

### 7.3 OTP and Verification
- OTP verification flow exists or needs implementation
- emailVerified and phoneVerified boolean fields on User model
- KycStatus enum tracks verification state (NOT_STARTED, PENDING, VERIFIED, REJECTED, EXPIRED, MANUAL_REVIEW)

## 8. CSRF PROTECTION

- NestJS default CSRF protection configured where applicable
- State-changing endpoints protected

## 9. DATA PRIVACY

### 9.1 User Data Exposure
- PublicUser interface intentionally omits sensitive fields (password, token, IP, etc.)
- Profile endpoints return only safe display identifiers
- Referral endpoint returns masked email (e.g., "t***e@example.com")
- No password or token exposure in any API response

### 9.2 Referral Privacy
- Referred user data only shows username + masked email
- No private credentials exposed to other users
- Endpoint scoped to authenticated caller only

## 10. OUTSTANDING SECURITY CONCERNS

| Concern | Severity | Recommendation |
|---------|----------|----------------|
| Admin permission checks on all endpoints | HIGH | Verify every admin controller has proper @Roles() and @Permissions() decorators |
| Withdrawal OTP/security verification | MEDIUM | Implement OTP or 2FA for withdrawal requests; ensure security verification before fund release |
| Deposit backend verification | MEDIUM | Ensure deposit status comes from backend webhook verification, not frontend |
| Real-money trading not enabled without approvals | HIGH | Confirm real-money trading remains disabled until legal/licensing approved |
| Webhook signature verification | MEDIUM | Implement provider webhook signature verification (AES-256-GCM encrypted keys already in schema) |
| Rate limiting configuration | LOW | Review and optimize rate limits per endpoint type |
| XSS protection in user content | LOW | Verify all user-generated content is properly sanitized before display |
- API endpoints for financial operations have CSRF tokens or are exempt with justification