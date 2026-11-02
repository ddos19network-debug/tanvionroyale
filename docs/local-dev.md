# Local development

Get the whole monorepo running locally in free-play mode. Everything here is
**FREE_PLAY only** — `ROYALE_MODE=FREE_PLAY` and `ROYALE_REAL_MONEY_ALLOWED=false`
are the shipped defaults in `.env.example` and must stay that way locally.
Free-play points are never money: they live in `CrashFreePlayWallet`
(currency `FREEPLAY`), have no deposit/withdrawal path, and cannot be exchanged.

## Prerequisites

| Tool    | Version                                                                           |
| ------- | --------------------------------------------------------------------------------- |
| Node.js | >= 20 (`node -v`)                                                                 |
| pnpm    | 9 (repo pins `pnpm@9.12.1`; run `corepack enable`)                                |
| Docker  | Docker Desktop / Engine with the **Compose v2** plugin (`docker compose version`) |

## Quick start (one command)

```bash
pnpm dev:local
```

Cross-platform (Windows / macOS / Linux) orchestrator
(`scripts/dev-local.mjs`) that runs the full pipeline below and then starts the
dev servers. Useful flags:

```bash
pnpm dev:local --no-dev         # infra + install + db only, then stop
pnpm dev:local --skip-install   # reuse existing node_modules
```

The script fails fast with an actionable message if Node/pnpm/Docker is
missing, skips `docker compose` when Postgres is already reachable on
`localhost:5432`, and never overwrites an existing `.env`.

## Manual steps (same pipeline, step by step)

```bash
# 1. Infrastructure: Postgres 16 + Redis 7
docker compose up -d

# 2. Environment (never commit real secrets)
#    Windows (PowerShell):  Copy-Item .env.example .env
#    macOS / Linux:         cp .env.example .env
#    .env.example defaults point at the docker-compose services
#    (localhost:5432 / localhost:6379) and keep ROYALE_MODE=FREE_PLAY.

# 3. Install workspace dependencies
pnpm install

# 4. Prisma client + schema migrations
pnpm db:generate
pnpm db:migrate

# 5. Seed RBAC + the development sports/partner catalog
pnpm db:seed

# 6. Seed the FREE-PLAY test user (status ACTIVE, points balance, no real funds)
pnpm db:seed:freeplay-user

# 7. Seed a LOCAL ADMIN account so you can sign in at /admin/login
pnpm db:seed:admin

# 8. Start the dev servers (turbo runs both)
pnpm dev
```

Stop infrastructure later with `docker compose down` (add `-v` to also drop
the data volumes and start clean).

## FREE-PLAY test user

`pnpm db:seed:freeplay-user` upserts exactly one account:

| Field    | Value                                                                 |
| -------- | --------------------------------------------------------------------- |
| Email    | `freeplay@test.local`                                                 |
| Username | `freeplaytester`                                                      |
| Password | `FreePlay123!` (argon2id)                                             |
| Status   | `ACTIVE`                                                              |
| Bankroll | 100 000 **FREEPLAY points** (a `CrashFreePlayWallet` row — not money) |

It is idempotent (re-running resets the points balance), refuses to run when
`NODE_ENV=production`, and touches no real `Wallet` row. Log in with the email
or the username, then open the Royale Ace game — the UI shows a permanent
**“FREE PLAY — no real money”** banner whenever the server mode is `FREE_PLAY`.

## Local admin account (`/admin/login`)

`POST /auth/admin-login` only authenticates **STAFF** accounts, and the normal
pipeline (`db:seed`, `db:seed:freeplay-user`, `db:bootstrap`) creates no staff
account — so without this step there is nobody who can sign in at
`/admin/login` and every attempt fails. `pnpm db:seed:admin` closes that gap.

`pnpm db:seed:admin` upserts exactly one account:

| Field    | Value                          |
| -------- | ------------------------------ |
| Email    | `admin@local.test`             |
| Username | `localadmin`                   |
| Password | `Admin@12345` (argon2id)       |
| Role     | `ADMIN` (account type `STAFF`) |
| Status   | `ACTIVE`                       |

It is idempotent, refuses to run when `NODE_ENV=production`, and grants the
**ADMIN** role (not `SUPER_ADMIN`) on purpose: `MASTER_ADMIN_EMAILS` is capped at
exactly two permanent master admins, so a local seed must never consume one of
those slots or depend on an allowlist entry. Sign in at
`http://localhost:3100/admin/login` with the username **or** the email.

> Real owner/master-admin accounts are created separately with
> `bootstrap-master-admin.ts` (allowlist-gated, audited) — never by this dev
> seed. Override the seeded identity with `LOCAL_DEV_ADMIN_EMAIL` /
> `LOCAL_DEV_ADMIN_USERNAME` / `LOCAL_DEV_ADMIN_PASSWORD` if you need to.

## Ports

- **API** (NestJS): `http://localhost:3000` — Swagger at `/docs`, REST under
  `/api/v1`. Override with `PORT` / `API_PORT`.
- **Web** (Next.js): `http://localhost:3100` (pinned by the `dev`/`start`
  scripts via `next dev -p 3100` / `next start -p 3100`; also documented as
  `WEB_PORT` in `.env.example`). It calls the API via the absolute
  `NEXT_PUBLIC_API_URL` from `.env` (default `http://localhost:3000/api/v1`)
  — the web app never proxies `/api`.
- **Postgres**: `localhost:5432`, **Redis**: `localhost:6379` (docker-compose).

If the web app cannot reach the API, double-check `NEXT_PUBLIC_API_URL` in
`.env` matches the actual API port.

## Tests

```bash
# Web: unit/component regression scripts (Royale Ace machine included)
pnpm --filter @tanvion-royale/web test

# Web: Royale Ace only (replayer machine, theme, geometry, drop order, chrome)
pnpm --filter @tanvion-royale/web test:ace
pnpm --filter @tanvion-royale/web exec node scripts/test-ace-geometry.cjs   # 68x86 card / 372x365 board
pnpm --filter @tanvion-royale/web exec node scripts/test-ace-drop-order.cjs # bottom-row-first drop

# API: Royale suites (ace math/service, fairness, eligibility, plinko, mines, gate)
pnpm --filter @tanvion-royale/api test -- royale

# Math verification (RTP gate; exits non-zero if outside tolerance)
pnpm sim:royale-ace -- --spins 5000000

# Type checks
pnpm --filter @tanvion-royale/web type-check
pnpm --filter @tanvion-royale/api type-check
```

## Troubleshooting

- **`docker: command not found`** — install Docker Desktop, or start a local
  Postgres on 5432 yourself; the orchestrator probes the port first.
- **Port 5432 already in use** by a non-compose Postgres — that is fine, the
  script will skip compose; make sure credentials match `.env`.
- **`prisma migrate` fails** — run `docker compose ps` to confirm Postgres is
  healthy (`pg_isready`), then retry `pnpm db:migrate`.
- **Prisma client out of date after pulling** — `pnpm db:generate`.
- **Real money** — do not change `ROYALE_MODE` / `ROYALE_REAL_MONEY_ALLOWED`.
  Real money is fail-closed behind licensed-operator + payment gates that are
  intentionally unimplemented; locally you only ever play FREE_PLAY.

### Port already in use (3000 API / 3100 web)

`EADDRINUSE: address already in use 0.0.0.0:3000` means an old API/node
process is still running (or `pnpm dev` was started twice). Port **3100**
(web) can hit the same issue. Check who holds a port and stop it:

```bash
pnpm ports:check   # lists PID + process name for 3000/3100 and the exact kill command
pnpm ports:free    # stops ONLY the process holding a busy port (prints name + PID first)
```

Nothing is ever killed without `ports:free`. Equivalent manual commands —
Windows: `netstat -ano | findstr :3000` then `taskkill /PID <pid> /F`;
macOS/Linux: `lsof -nP -iTCP:3000 -sTCP:LISTEN` then `kill <pid>`.

`pnpm dev:local` runs `ports:check` automatically right before starting the
dev servers and fails fast with these instructions, and the API itself now
prints the same friendly message (then exits with code 1) if it loses the
race for port 3000.
