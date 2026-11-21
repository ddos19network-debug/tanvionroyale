# TANVIONROYALE — PROJECT AUDIT
**Phase:** Phase 3: Core Application Development  
**Date:** November 2026  
**Status:** Complete & Verified  

---

## 1. Executive Summary & Architecture Overview

TANVIONROYALE is an institutional-grade, multi-vertical digital gaming, exchange, and financial platform built with a high-performance modern web and API architecture.

### Technology Stack
- **Monorepo Architecture:** Turborepo + PNPM workspaces
- **Frontend (`apps/web`):** Next.js 14 (App Router, Server & Client Components), Tailwind CSS, Lucide icons, `@tanvion-royale/ui` component library
- **Backend (`apps/api`):** NestJS 10, TypeScript 5, Node.js 20, Prisma ORM 5, PostgreSQL
- **Shared Packages (`packages/`):** `@tanvion-royale/types`, `@tanvion-royale/ui`
- **Database (`database/`):** PostgreSQL with Prisma Schema (80+ models, 30+ relational domain migrations)

---

## 2. Core Application Domains & Scope Boundaries

### In-Scope Core Application Modules (Phase 3)
1. **Dashboard (`/dashboard`):** Unified multi-domain executive overview (User Profile, Wallet Balances, Trading Summary, Referral Overview, Recent Activity, Quick Actions).
2. **User Profile (`/profile`, `/settings`):** Account overview, UID, display name, KYC status, VIP tier, account creation dates, security settings, privacy controls.
3. **Assets (`/assets`):** Multi-asset catalog, asset search, real-time holdings, market valuations, trading position reconciliation, deposit/withdrawal enablement indicators.
4. **Main Wallet (`/wallet`, `/wallet/transactions`):** Multi-currency balance ledger (BDT, USD, EUR), available vs locked balances, full transaction history, filtering, pagination.
5. **Deposit Flow (`/wallet/deposit`):** Gateway and manual deposit workflows (bKash, Nagad, Rocket, Bank, Card), transaction reference capture, proof uploads, admin approval pipeline.
6. **Withdrawal Flow (`/wallet/withdraw`):** Available balance enforcement, bank and mobile banking payout destination validation, fund reservation, admin review workflow.
7. **Trading Terminal (`/trading`):** Exness-grade trading interface, multi-timeframe candle aggregator, drawing tools, live ticker feeds, order execution panel, margin calculations.
8. **Admin Panel (`/admin/*`):** Financial operations, pending deposits/withdrawals, payment methods, gateway configurations, role-based access control (RBAC).

### Strict Royale Play Exclusion Boundary
As mandated by platform scope protection, all Royale Play game code, engines, controllers, assets, and mathematics remain isolated and strictly untouched:
- `apps/api/src/modules/royale/` (Royale Ace, Plinko, Mines, etc.)
- `apps/web/components/games/` (Game engines, visual components, sound engines)
- `FREE_PLAY` session lifecycles and virtual points logic.

---

## 3. Directory Structure & Verification

```
tanvionroyale/
├── apps/
│   ├── api/                     # NestJS backend API
│   │   ├── src/
│   │   │   ├── common/          # Guards (JWT, RBAC), decorators, filters
│   │   │   ├── database/        # Prisma service & client
│   │   │   └── modules/         # Domain modules (wallet, users, trading, etc.)
│   │   └── test/                # Jest unit & integration test suites (80+ specs)
│   └── web/                     # Next.js web application
│       ├── app/
│       │   ├── (user)/          # User-facing routes (dashboard, wallet, assets, profile, trading)
│       │   └── admin/           # Administrative portal routes
│       ├── components/          # Domain components (trading, profile, layout)
│       └── lib/api/             # Typed API clients with JWT authentication
├── database/                    # Prisma migrations and canonical schema.prisma
├── packages/                    # Monorepo shared packages (types, UI)
└── docs/                        # Specifications, audit documents, RTP reports
```

---

## 4. Verification & Health Summary
- **API Build & Type Check:** 0 TypeScript errors (`pnpm --filter @tanvion-royale/api exec tsc --noEmit`)
- **Web Build & Type Check:** 0 TypeScript errors (`pnpm --filter @tanvion-royale/web exec tsc --noEmit`)
- **Production Build:** Next.js static and dynamic routes compiled successfully across all 76 application routes.
