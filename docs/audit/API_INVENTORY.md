# TANVIONROYALE — API INVENTORY

## 1. API ARCHITECTURE OVERVIEW

**Framework:** NestJS with Prisma ORM  
**Base path:** `apps/api/src/`  
**Module structure:** Feature-based modules in `apps/api/src/modules/`  
**Prisma client:** Generated into `apps/api/src/generated/prisma`  
**Authentication:** JWT/bearer token  
**API response structure:** Consistent across endpoints

## 2. MODULE INVENTORY

### 2.1 Wallet Module (`apps/api/src/modules/wallet/`)

**Key services:**
- `wallet.service.ts` — Full ledger-based wallet engine with idempotency
- `withdrawal.service.ts` — Withdrawal orchestration with provider integration
- `wallet.config.ts` — Wallet configuration loading

**DTOs/Types:**
- `WalletView`, `WalletBalanceView` — Balance response types
- `WalletTransactionView` — Transaction response type

## 3. REFERRAL MODULE

### 2.2 Referral Module (`apps/api/src/modules/referral/`)

**Key services:**
- `affiliate.service.ts` — Full referral service with qualification rules
- `admin-affiliate.controller.ts` — Admin referral configuration
- `affiliate.controller.ts` — User-facing referral endpoints

**DTOs/Types:**
- `MyReferralSummary` — Referrer's own summary
- `MyReferredUser` — Referred user display info
- `ReferralSettingsView` — Program configuration

## 4. ADMIN MODULE

### 2.3 Admin Module (`apps/api/src/modules/admin/`)

**Key services:**
- `admin.service.ts` — 66,847 lines; comprehensive admin operations
- `admin.module.ts` — Admin module setup

**Endpoints overview:**
- User management: list, details, status/role updates
- Financial management: wallet liabilities, transaction history
- Referral program overview
- Activity and audit logs
- System settings and reports

**DTOs/Types:**
- `AdminQueriesDto` — Query parameters for admin list endpoints
- Various DTOs for user modification, financial reports

## 5. TRADING MODULE

### 2.4 Trading Module (`apps/api/src/modules/trading/`)

**Key services:**
- Trading service with market data aggregation
- Candle aggregation and WebSocket price updates

**Endpoints overview:**
- Market data: candles, order book, ticker prices
- Order execution: buy/sell orders
- Portfolio and positions management

**Concerns:** TypeScript errors (TS2323, TS2484) reported for duplicate exports; candle aggregation needs inspection

**DTOs/Types:**
- Market pair types
- Candle data structures
- Order submission DTOs
- Position and portfolio views

## 6. ROYALE MODULE (EXCLUDED)

### 2.5 Royale Module (`apps/api/src/modules/royale/ace/`)

**Status:** Excluded from modification — Royale Play games  
**Endpoints:** Casino catalog, game sessions, admin config — all OUT OF SCOPE  
**Note:** All Royale Play game APIs and controllers must not be modified per development boundary

## 7. BETTING MODULE

### 2.6 Betting Module (`apps/api/src/modules/betting/`)

**Endpoints overview:**
- Sports categories, events, fixtures
- Betting markets and odds
- Bet settlement and resolution

**Status:** Audit existing sportsbook functionality; complete non-game admin features

## 8. SHARED ENDPOINTS

### 2.7 Common Endpoints (All Modules)

**Authentication:**
- `POST /auth/login` — User login
- `POST /auth/register` — User registration
- `POST /auth/refresh` — Refresh JWT token
- `GET /auth/me` — Current user profile

**Health and utils:**
- `GET /health` — Health check
- `GET /version` — API version

**Webhooks:**
- `POST /webhook/idempotency` — Idempotency key validation
- `POST /webhook/payment` — Payment provider webhooks
- `POST /webhook/casino` — Casino game webhooks
- `POST /webhook/sports` — Sports result webhooks

## 9. API CONTRACT COMPLIANCE

### Response Structure
All API responses should follow consistent structure:
```json
{
  "success": boolean,
  "data": {},
  "errors": [], 
  "meta": { "pagination": {} }
}
```

### Authentication Guard
- `AuthGuard` validates JWT token on protected routes
- `PublicGuard` allows anonymous access where needed
- Rate limiting per endpoint type

### Validation
- All input DTOs validated using class-validator + class-transformer
- Zod schemas in `packages/validation/` for complex validation
- Idempotency key validation for financial requests

### Error Handling
- Custom exception filters for consistent error responses
- Error codes: `INVALID_AMOUNT`, `UNSUPPORTED_CURRENCY`, `AMOUNT_OUT_OF_RANGE`, etc.
- Proper HTTP status codes (400, 401, 403, 404, 422, 500)

## 10. OUTSTANDING API CONCERNS

| Concern | Module | Severity |
|---------|--------|----------|
| TypeScript errors (TS2323, TS2484 duplicate exports) | Trading | HIGH |
| Candle aggregation implementation inspection | Trading | HIGH |
| Provider integration completeness | Trading | MEDIUM |
| Referral claim backend verification | Referral | MEDIUM |
| Deposit backend verification | Wallet | MEDIUM |
| Withdrawal OTP/security flow | Wallet | MEDIUM |
| Admin permission checks on all endpoints | Admin | HIGH |
| Response structure consistency | All | MEDIUM |
| Webhook signature verification | All | MEDIUM |