# TANVION Multi-Asset Trading System - Implementation Plan

## Project Stack (as found in repository)
- Frontend: Next.js + TypeScript + Tailwind CSS + shadcn/ui (@tanvion-royale/ui)
- Backend: NestJS + TypeScript + Prisma + **PostgreSQL** (NOT MongoDB as task states)
- Real-time: Socket.IO gateways exist (crash.gateway.ts, roulette.gateway.ts)
- Auth: JWT-based with roles/permissions
- Wallet: Existing wallet module with ledger entries
- Admin: Permission system with TRADING_READ, TRADING_MANAGE

## Phase Plan

### Phase 1: Repository Audit ✅ COMPLETE
- Inspected frontend/backend structure
- Identified existing wallet, transaction, auth modules
- Identified Admin permission system
- Inspected Prisma schema models
- Identified Socket.IO gateways
- Inspected environment configuration

### Phase 2: Database Schema & Types
- Extend Prisma schema with new trading collections
- Add type definitions in packages/types/src/
- Generate Prisma client

### Phase 3: Trading Wallet & Ledger (Separate from main Wallet)
- TradingWallet model with Available/Reserved/Pending Settlement
- Double-entry TradingLedger
- Immutable ledger transactions
- No floating-point arithmetic (integer minor units)

### Phase 4: Trading Engine Foundation
- Order Validator
- Risk Validator
- Balance Reservation
- Execution Router
- Order State Manager (NEW → VALIDATING → RESERVED → SUBMITTING → ACKNOWLEDGED → PARTIALLY_FILLED → FILLED / CANCELLED / REJECTED)
- Fill Processor
- Settlement Processor
- Fee Calculator

### Phase 5: Market Data & Adapters
- Common adapter interface (ICryptoAdapter, IForexAdapter, IStockAdapter)
- Provider-independent market data
- Demo provider (existing) + sandbox adapter boundaries

### Phase 6: Frontend Dashboard & Trading Terminal
- Trading Dashboard with portfolio values
- Market selector, pair selector
- Buy/Sell panel with order confirmation
- Order types: Market, Limit, Stop-Limit
- Chart intervals: 1m, 5m, 15m, 30m, 1H, 4H, 1D, 1W, 1M
- Order book, recent trades

### Phase 7: Real-time (Socket.IO)
- Socket.IO trading gateway with authentication
- User-specific rooms
- Events: market:price, trading:order:updated, trading:wallet:updated, etc.

### Phase 8: Admin Panel
- Market management (enable/disable, pairs, hours, limits)
- Order management (view all orders by status)
- Wallet management (view trading wallets, deposits, withdrawals)
- Provider management (connections, health, webhooks)
- User management (trading eligibility, KYC, suspend)
- Risk management (limits, circuit breaker, kill switch)
- Reports (volume, fees, reconciliation)

### Phase 9: Security & Compliance
- JWT auth + RBAC
- MFA for sensitive actions
- API credential encryption
- Webhook signature verification
- Rate limiting
- KYC/AML integration points
- Jurisdiction-based restrictions
- Real-money safety gates (TRADING_MODE=DEMO, REAL_EXECUTION_ENABLED=false)

### Phase 10: Testing & Integration
- Unit, integration, E2E tests
- Load tests
- TypeScript checks
- Build verification

## Files to Create/Modify

### Backend (apps/api/src/modules/trading/)
1. trading.module.ts - EXTEND existing
2. trading.controller.ts - EXTEND existing  
3. trading.service.ts - EXTEND existing
4. dto/trading.dto.ts - EXTEND existing
5. NEW: trading-wallet.service.ts
6. NEW: trading-ledger.service.ts
7. NEW: order-validator.service.ts
8. NEW: risk-validator.service.ts
9. NEW: balance-reservation.service.ts
10. NEW: execution-router.service.ts
11. NEW: order-state-manager.service.ts
12. NEW: fill-processor.service.ts
13. NEW: settlement-processor.service.ts
14. NEW: fee-calculator.service.ts
15. NEW: reconciliation.service.ts
16. NEW: adapters/adapter-interface.ts
17. NEW: adapters/crypto.adapter.ts
18. NEW: adapters/forex.adapter.ts
19. NEW: adapters/stock.adapter.ts
20. NEW: gateway/trading.gateway.ts (Socket.IO)
21. NEW: gateway/auth.socket.guard.ts
22. NEW: dto/trading-wallet.dto.ts
23. NEW: dto/order.dto.ts
24. config/trading-safety.config.ts

### Frontend (apps/web/)
25. app/(user)/trading/page.tsx - EXTEND
26. app/(user)/trading/dashboard/page.tsx - NEW
27. app/(user)/trading/markets/page.tsx - EXTEND
28. app/(user)/trading/terminal/page.tsx - NEW
29. app/(user)/trading/watchlist/page.tsx - NEW
30. app/(user)/trading/orders/page.tsx - NEW
31. app/(user)/trading/portfolio/page.tsx - EXTEND
32. app/(user)/trading/wallet/page.tsx - NEW
33. app/(user)/trading/settings/page.tsx - NEW
34. components/trading/chart-terminal.tsx - NEW
35. components/trading/order-book.tsx - NEW
36. components/trading/buy-sell-panel.tsx - NEW
37. components/trading/order-confirmation.tsx - NEW
38. components/trading/watchlist-item.tsx - NEW
39. lib/api/trading-wallet.ts - NEW
40. lib/api/market-data.ts - NEW
41. lib/socket/trading-socket.ts - NEW

### Admin Panel
42. app/admin/trading/page.tsx - NEW
43. app/admin/trading/markets/page.tsx - NEW
44. app/admin/trading/orders/page.tsx - NEW
45. app/admin/trading/wallets/page.tsx - NEW
46. app/admin/trading/providers/page.tsx - NEW
47. app/admin/trading/users/page.tsx - NEW
48. app/admin/trading/risk/page.tsx - NEW
49. app/admin/trading/reports/page.tsx - NEW

### Types (packages/types/src/)
50. trading-wallet.ts - NEW
51. trading-engine.ts - NEW
52. trading-adapters.ts - NEW
53. trading-admin.ts - NEW
54. Extend admin.ts with new trading permissions

### Config
55. .env.example - Add trading env vars
56. apps/api/src/config/trading-safety.config.ts - NEW
