# TANVIONROYALE

Professional, production-ready **sportsbook platform**.

TANVIONROYALE is the branded, customer-facing web platform. Regulated operations
(betting acceptance, odds source, settlement, deposits, withdrawals, KYC/AML)
remain with a **licensed betting operator**, integrated through a secure,
isolated operator-integration layer. TANVIONROYALE never secretly holds customer
gambling funds or operates an unlicensed sportsbook.

```
USER
  -> TANVIONROYALE WEBSITE (apps/web)
  -> TANVIONROYALE BACKEND (apps/api)
  -> OPERATOR INTEGRATION LAYER (packages/integrations)
  -> LICENSED OPERATOR
```

## Monorepo structure

```text
apps/
  web/   Next.js + React + Tailwind frontend
  api/   NestJS REST API + WebSocket
packages/
  ui/             shared UI components
  types/          shared TypeScript types / DTOs
  validation/     shared validation schemas
  config/         shared configuration helpers
  integrations/   operator/provider adapters (core, interfaces, mock-provider, providers/*)
database/
  prisma/         Prisma schema, migrations, seed
infra/
  docker/ nginx/ monitoring/ deployment/
docs/             architecture, api, security, integrations, deployment, business-flow
scripts/          dev/ops scripts
```

## Stack

- **Frontend:** Next.js, TypeScript, React, Tailwind CSS, shadcn/ui
- **Backend:** NestJS, TypeScript, REST, WebSocket
- **Database:** PostgreSQL + Prisma ORM
- **Caching/queues:** Redis + BullMQ
- **Auth:** JWT + session, refresh-token rotation, Argon2, 2FA-ready
- **Infra:** Docker, Docker Compose, environment-driven configuration

## Getting started

See [docs/deployment/production.md](docs/deployment/production.md) and
[docs/architecture/system-overview.md](docs/architecture/system-overview.md).

```bash
# 1. Install pnpm (Node >= 20):
corepack enable
corepack prepare pnpm@9.12.1 --activate

# 2. Install dependencies
pnpm install

# 3. Start local infra (Postgres + Redis) — requires Docker
docker compose up -d

# 4. Configure environment
cp .env.example .env

# 5. Generate Prisma client / migrate / seed
pnpm db:generate
pnpm db:migrate
pnpm db:seed

# 6. Run in development
pnpm dev
```

## Deployment

- **Frontend -> Vercel.** The Vercel project targets the `apps/web` Next.js app. Set the
  project **Root Directory to `apps/web`** (or leave it unset — the committed
  top-level `vercel.json` declares `"rootDirectory": "apps/web"`). Both
  `vercel.json` files pin the install/build commands to run from inside the app
  directory: `pnpm install --frozen-lockfile` installs the full pnpm workspace
  (pnpm walks up to `pnpm-workspace.yaml`), then
  `pnpm turbo run build --filter=@tanvion-royale/web...` builds the web app and
  its workspace dependencies. `next` is also pinned in the root `package.json`
  so Vercel's Next.js version detection (`@vercel/next` resolves
  `next/package.json` walking up from the Root Directory) always finds it.
- **Backend -> Render.** See `render.yaml` (API container only).

## Scripts

| Script | Description |
| ------ | ----------- |
| `pnpm dev` | Run web + api in dev mode (turbo) |
| `pnpm build` | Build all workspaces |
| `pnpm lint` | Lint all workspaces |
| `pnpm type-check` | Type-check all workspaces |
| `pnpm test` | Unit + integration tests |
| `pnpm test:e2e` | E2E tests |
| `pnpm db:migrate` | Run Prisma migrations |

## Important rules

- **Never** let the frontend call the licensed operator directly.
  Frontend → Backend → Integration layer → Operator.
- **Never** invent production odds, fake payments, or fake bet acceptance.
  Use the mock provider until a real licensed provider is configured.
- **Never** commit real secrets.
- Financial records are immutable and audited; corrections require adjustment
  records with reason + admin id + timestamp.
- Money amounts use exact decimal/minor-unit representations, never floats.

## Documentation

- [System overview](docs/architecture/system-overview.md)
- [Data flow](docs/architecture/data-flow.md)
- [Payment flow](docs/architecture/payment-flow.md)
- [Betting flow](docs/architecture/betting-flow.md)
- [Operator integration](docs/architecture/operator-integration.md)
- [Security model](docs/security/security-model.md)
- [API — operator integration](docs/api/operator-integration.md)
- [Production deployment](docs/deployment/production.md)

## License

Proprietary. Copyright © TANVIONROYALE.

# tanvionroyale
