/**
 * TANVIONROYALE — production-safe catalog bootstrap.
 *
 * Creates ONLY the two publicly promoted sports-hub entries (Football and
 * Cricket) as ACTIVE sports. It deliberately creates NO competitions, games,
 * events, markets, selections, odds or provider rows: those must come from
 * the authorized partner provider via SportsSyncService (or be created by an
 * admin). Nothing fabricated — ever.
 *
 * Idempotent (upsert on unique slug) and safe in EVERY environment including
 * production. Run with:
 *   pnpm db:bootstrap
 *   (or from apps/api: pnpm prisma:bootstrap)
 */
// Explicit /index.js — required for Node ≥22.18 where this script is loaded as
// ESM (directory imports are unsupported there), while still working under
// ts-node's CommonJS compilation.
import { PrismaClient } from '../../apps/api/src/generated/prisma/index.js';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Local-dev convenience: load the repo-root .env (if any) so the script can run
 * with `pnpm db:bootstrap` outside Render. Real environment variables ALWAYS
 * win (existing process.env is never overridden), so this is safe in production
 * where DATABASE_URL is injected as a true env var.
 *
 * Uses cwd-based lookup (never `__dirname`) because Node ≥22.18 executes this
 * file as ESM where `__dirname` is undefined, while ts-node compiles it to CJS.
 * `pnpm --filter @tanvion-royale/api prisma:bootstrap` runs with apps/api as
 * cwd, so the repo root is two levels up; a direct run from the repo root is
 * also covered.
 */
(function loadRootEnv(): void {
  const candidates = [
    path.join(process.cwd(), '.env'),
    path.join(process.cwd(), '..', '..', '.env'),
  ];
  for (const envPath of candidates) {
    if (!fs.existsSync(envPath)) continue;
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
    }
    return;
  }
})();

const prisma = new PrismaClient();

interface SeedSport {
  name: string;
  slug: string;
  description: string;
  icon: string;
  sortOrder: number;
}

/** Only public sports — the rest of the tree must be provider-driven. */
const SPORTS: readonly SeedSport[] = [
  {
    name: 'Football',
    slug: 'football',
    description: 'Football leagues, cups and international fixtures supplied by our licensed partner.',
    icon: 'football.svg',
    sortOrder: 1,
  },
  {
    name: 'Cricket',
    slug: 'cricket',
    description: 'Cricket — Test, ODI and T20 domestic and international competitions supplied by our licensed partner.',
    icon: 'cricket.svg',
    sortOrder: 2,
  },
];

async function main(): Promise<void> {
  for (const seed of SPORTS) {
    const row = await prisma.sport.upsert({
      where: { slug: seed.slug },
      update: {
        name: seed.name,
        description: seed.description,
        icon: seed.icon,
        status: 'ACTIVE',
        sortOrder: seed.sortOrder,
      },
      create: {
        name: seed.name,
        slug: seed.slug,
        description: seed.description,
        icon: seed.icon,
        status: 'ACTIVE',
        sortOrder: seed.sortOrder,
      },
    });
    console.log(`Sport "${seed.slug}" ensured ACTIVE (id=${row.id}).`);
  }
  console.log(
    'Catalog bootstrap complete: Football and Cricket are active. No events, markets, selections or odds were created (partner-provider driven only).',
  );
}

main()
  .catch((error) => {
    console.error('Catalog bootstrap failed:', error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());