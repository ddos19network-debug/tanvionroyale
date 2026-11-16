# TANVIONROYALE — PROJECT AUDIT

## 1. REPOSITORY OVERVIEW

**Local Path:** `D:\tanvionRoyale`  
**GitHub:** `https://github.com/tanvionroyale/tanvionroyale`  
**Audited At:** 2026-11-14

## 2. ARCHITECTURE LAYERS

### 2.1 Frontend
- **Framework:** Next.js 14 (App Router) with React
- **UI Components:** React components in `apps/web/components/`
- **Pages:** App Router routes in `apps/web/app/`
- **Styling:** Tailwind CSS with custom design tokens in `apps/web/globals.css`
- **Navigation:**
  - Desktop: Sidebar (`components/navigation/sidebar.tsx` via `app/header.tsx`)
  - Mobile: Bottom navigation (`components/navigation/bottom-nav.tsx`)
  - Mobile drawer: `components/navigation/mobile-nav-drawer.tsx`
- **Auth:** Context-based auth in `apps/web/src/lib/auth.tsx`
- **Key Pages:** Home, Auth (login/register), User (profile, wallet, trading), Admin, Games, Sports, Referral, Rewards, Settings

### 2.2 Backend
- **Framework:** NestJS
- **API Modules:** Located in `apps/api/src/modules/`
- **Modules discovered:**
  - `wallet` — wallet ledger, deposits, withdrawals, balance management
  - `referral` — referral/affiliate program with full service layer
  - `admin` — admin panel controllers and services
  - `trading` — trading terminal and market data
  - `royale/ace` — casino/winhouse games (excluded from scope)
  - `betting` — sportsbook administration
  - `notification`, `support`, `responsible-gambling`
  - `partner`, `webhook-idempotency`

### 2.3 Database
- **ORM:** Prisma 5.x
- **Schema:** `database/prisma/schema.prisma` (3,857 lines)
- **Migrations:** `database/prisma/migrations/` (30+ migrations)
- **Database:** PostgreSQL (Neon host)
- **Prisma client:** Generated into `apps/api/src/generated/prisma`

### 2.4 Types & Shared Code
- **Package:** `packages/types/` — shared TypeScript types/interfaces
- **Package:** `packages/ui/` — UI component primitives
- **Package:** `packages/validation/` — Zod validation schemas
- **Package:** `packages/config/` — configuration
- **Package:** `packages/integrations/` — external provider integrations
- **Package:** `packages/validation/` — validation schemas

## 3. SCOPE EXCLUSION — ROYALE PLAY GAMES

The following are EXCLUDED from all modification and are marked **OUT OF SCOPE — ROYALE PLAY**:

- All existing Royale Play games (slots, dice, crash, freeplay, etc.)
- Game interfaces, layouts, animations, effects
- Game engine logic, algorithms, and outcomes
- Game assets, images, sounds, and animations
- Game APIs and game controllers
- Game database models and migrations
- Existing game configurations
- Game-specific admin settings
- WinHouse player identity and game sessions
- All game-specific UI components (ace-slot-game, atlantis-game, solitaire, etc.)

Any issues found inside Royale Play modules must be recorded in the audit report as **OUT OF SCOPE — ROYALE PLAY** but NOT modified.

The exclusion boundary is defined as: all code under `apps/api/src/modules/royale/`, `apps/web/components/games/`, and any game-specific API routes.

## 4. FILE COUNT SNAPSHOT

**Source files examined (production code only, excluding dist/, node_modules, .tmp):**

| Layer | Count |
|-------|-------|
| API source (.ts) | ~120 files |
| Web source (.tsx/.ts) | ~80 files |
| Prisma schema | 1 file (3,857 lines) |
| Migrations | 30+ files |
| Type definitions | ~15 files |
| CSS/Skin files | ~10 files |

## 5. KEY CONFIGURATION FILES

- `package.json` — root package configuration, pnpm workspace
- `pnpm-lock.yaml` — lockfile
- `turbo.json` — build pipeline configuration
- `prisma-status-v*.txt` — migration status tracking files
- `env.example` — environment variable templates
- `turbo-build.txt` — build troubleshooting notes

## 6. NOTABLE OBSERVATIONS

1. The project has extensive existing functionality across wallet, referral, admin, trading, and casino modules
2. Many TypeScript type definitions exist in `packages/types/` and are used across the codebase
3. The wallet service implements a ledger-based financial accounting approach with idempotency protection
4. The referral/affiliate system has a full service layer with qualification rules and commission tracking
5. The admin service is comprehensive (66,847 lines) covering user management, financial operations, trading, and system settings
6. Several `.tmp-*` directories exist suggesting prior audit/repair attempts
7. The project uses integer minor units for all monetary amounts (consistent with the schema comment: "amounts use integer minor units (e.g. cents)")
8. Royale Play games are deeply integrated but must be treated as out-of-scope