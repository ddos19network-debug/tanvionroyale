/**
 * Seeds the RBAC foundation: all platform roles and their default permissions.
 * Run with: pnpm --filter @tanvion-royale/api prisma:seed
 *
 * Usage: npx ts-node ../../database/scripts/seed.ts (from apps/api)
 */
import { PrismaClient } from '../../apps/api/src/generated/prisma';
import { ADMIN_PERMISSION_NAMES } from '../../packages/types/src/admin';

/**
 * PRODUCTION SAFETY: this seed script provisions development roles/permissions
 * plus clearly-marked MOCK sports/events. It must NEVER run against a
 * production database. When NODE_ENV=production (Render) it refuses to start.
 */
if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to seed: mock development data must never be written to production.');
  process.exit(1);
}

const prisma = new PrismaClient();

const PERMISSIONS = [...ADMIN_PERMISSION_NAMES];
const has = (name: string): boolean => PERMISSIONS.includes(name as (typeof PERMISSIONS)[number]);

const ROLE_PERMISSIONS: Record<string, readonly string[]> = {
  SUPER_ADMIN: PERMISSIONS,
  ADMIN: PERMISSIONS.filter(
    (permission) =>
      !permission.startsWith('admins.') &&
      !permission.startsWith('roles.'),
  ),
  FINANCE: [
    'wallets.read', 'wallets.manage', 'deposits.read', 'deposits.review',
    'withdrawals.read', 'withdrawals.review', 'withdrawals.complete',
    'transactions.read', 'reports.read',
  ].filter(has),
  SUPPORT: [
    'support.read', 'support.reply', 'support.assign', 'support.update',
    'users.read', 'bets.read', 'betting.read', 'transactions.read',
  ].filter(has),
  COMPLIANCE: [
    'users.read', 'audit_logs.read', 'transactions.read', 'reports.read',
  ].filter(has),
  CONTENT_MANAGER: [
    'sports.read', 'sports.manage', 'casino.read', 'casino.manage',
    'partner_providers.read', 'partner_providers.update', 'partner_providers.sync',
  ].filter(has),
  ANALYST: [
    'users.read', 'betting.read', 'bets.read', 'wallets.read',
    'transactions.read', 'reports.read',
  ].filter(has),
  USER: [],
};

async function main(): Promise<void> {
  for (const permissionName of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { name: permissionName },
      update: {},
      create: { name: permissionName },
    });
  }

  for (const [roleName, permissionNames] of Object.entries(ROLE_PERMISSIONS)) {
    const role = await prisma.role.upsert({
      where: { name: roleName },
      update: {},
      create: { name: roleName },
    });

    for (const permissionName of permissionNames) {
      const permission = await prisma.permission.findUnique({ where: { name: permissionName } });
      if (permission) {
        await prisma.rolePermission.upsert({
          where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
          update: {},
          create: { roleId: role.id, permissionId: permission.id },
        });
      }
    }
  }

  console.log('Seed complete: roles and permissions provisioned.');

  await seedSportsCatalog(prisma);
  await seedCompetitions(prisma);
  await seedPartnerProviders(prisma);
  await seedBettingDomain(prisma);
  await seedPartnerEvents(prisma);
}

// ---------------------------------------------------------------------------
// Phase 4 — Sports / Games catalog seed (clearly fake, development-only data).
// Gambling availability is intentionally mixed: some games are non-gambling,
// some are gambling-enabled WITH an active mock provider mapping, and some
// combinations are deliberately invalid to test server-side enforcement.
// ---------------------------------------------------------------------------

interface SeedGame {
  name: string;
  slug: string;
  description: string;
  status: 'ACTIVE' | 'INACTIVE';
  sortOrder: number;
  gamblingEnabled: boolean;
  providerMapping?: { providerName: string; externalGameId: string; status: 'ACTIVE' | 'INACTIVE' };
}

interface SeedSport {
  name: string;
  slug: string;
  description: string;
  icon: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  sortOrder: number;
  games: SeedGame[];
}

main()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

const SPORTS_CATALOG: SeedSport[] = [
  {
    name: 'Football',
    slug: 'football',
    description: 'The world game — leagues, cups and international fixtures.',
    icon: 'football.svg',
    status: 'ACTIVE',
    sortOrder: 1,
    games: [
      {
        name: 'Premier League Match Winner',
        slug: 'football-premier-league-winner',
        description: 'Pick the winner of selected Premier League fixtures.',
        status: 'ACTIVE',
        sortOrder: 1,
        gamblingEnabled: true,
        providerMapping: { providerName: 'mock-operator', externalGameId: 'sport-football', status: 'ACTIVE' },
      },
      {
        name: 'Championship Totals',
        slug: 'football-championship-totals',
        description: 'Over/under totals game (non-gambling — display only).',
        status: 'ACTIVE',
        sortOrder: 2,
        gamblingEnabled: false,
      },
      {
        name: 'Retired Cup Predictor',
        slug: 'football-cup-predictor',
        description: 'Inactive game kept for catalogue history.',
        status: 'INACTIVE',
        sortOrder: 3,
        gamblingEnabled: false,
      },
    ],
  },
  {
    name: 'Cricket',
    slug: 'cricket',
    description: 'Test, ODI and T20 action from around the world.',
    icon: 'cricket.svg',
    status: 'ACTIVE',
    sortOrder: 2,
    games: [
      {
        name: 'T20 Match Winner',
        slug: 'cricket-t20-winner',
        description: 'T20 match winner game backed by the mock provider.',
        status: 'ACTIVE',
        sortOrder: 1,
        gamblingEnabled: true,
        providerMapping: { providerName: 'mock-operator', externalGameId: 'sport-cricket', status: 'ACTIVE' },
      },
      {
        name: 'Test Series Predictor',
        slug: 'cricket-test-series-predictor',
        description: 'Gambling-enabled flag but INACTIVE mapping — must stay non-gambling.',
        status: 'ACTIVE',
        sortOrder: 2,
        gamblingEnabled: true,
        providerMapping: { providerName: 'mock-operator', externalGameId: 'sport-cricket-inactive', status: 'INACTIVE' },
      },
    ],
  },
  {
    name: 'Tennis',
    slug: 'tennis',
    description: 'Grand Slams, ATP and WTA tours.',
    icon: 'tennis.svg',
    status: 'ACTIVE',
    sortOrder: 3,
    games: [
      {
        name: 'Grand Slam Set Betting',
        slug: 'tennis-grand-slam-sets',
        description: 'Non-gambling set-score predictor for Grand Slam matches.',
        status: 'ACTIVE',
        sortOrder: 1,
        gamblingEnabled: false,
      },
      {
        name: 'ATP Outright Winner',
        slug: 'tennis-atp-outright',
        description: 'ATP outright winner (gambling-enabled, mock provider).',
        status: 'ACTIVE',
        sortOrder: 2,
        gamblingEnabled: true,
        providerMapping: { providerName: 'mock-operator', externalGameId: 'sport-tennis', status: 'ACTIVE' },
      },
    ],
  },
  {
    name: 'Basketball',
    slug: 'basketball',
    description: 'NBA, EuroLeague and international basketball.',
    icon: 'basketball.svg',
    status: 'INACTIVE',
    sortOrder: 4,
    games: [
      {
        name: 'NBA Match Winner',
        slug: 'basketball-nba-winner',
        description: 'Inactive sport — hidden from public APIs.',
        status: 'ACTIVE',
        sortOrder: 1,
        gamblingEnabled: false,
      },
    ],
  },
];

/**
 * Seeds competitions (IPL, BPL, PSL, Premier League, Champions League, ...)
 * under their parent sports. Development fixtures only — never hard-coded in
 * the UI; the backend catalog is the source of truth.
 */
async function seedCompetitions(prisma: PrismaClient): Promise<void> {
  const competitions = [
    { sportSlug: 'football', name: 'Premier League', slug: 'premier-league', country: 'England', sortOrder: 1 },
    { sportSlug: 'football', name: 'Champions League', slug: 'champions-league', country: 'Europe', sortOrder: 2 },
    { sportSlug: 'cricket', name: 'IPL', slug: 'ipl', country: 'India', sortOrder: 1 },
    { sportSlug: 'cricket', name: 'BPL', slug: 'bpl', country: 'Bangladesh', sortOrder: 2 },
    { sportSlug: 'cricket', name: 'PSL', slug: 'psl', country: 'Pakistan', sortOrder: 3 },
    { sportSlug: 'basketball', name: 'NBA', slug: 'nba', country: 'USA', sortOrder: 1 },
    { sportSlug: 'tennis', name: 'ATP Tour', slug: 'atp-tour', country: 'International', sortOrder: 1 },
  ] as const;

  for (const comp of competitions) {
    const sport = await prisma.sport.findUnique({ where: { slug: comp.sportSlug } });
    if (!sport) continue;
    await prisma.competition.upsert({
      where: { sportId_slug: { sportId: sport.id, slug: comp.slug } },
      update: { name: comp.name, country: comp.country, sortOrder: comp.sortOrder, status: 'ACTIVE' },
      create: {
        sportId: sport.id,
        name: comp.name,
        slug: comp.slug,
        country: comp.country,
        sortOrder: comp.sortOrder,
        status: 'ACTIVE',
      },
    });
  }

  console.log('Seed complete: competitions provisioned (mock data only).');
}

/**
 * Seeds the allowlisted partner provider configuration. The base URL is the
 * ONLY destination the backend may redirect users to for partner events.
 * Development fixture only — never a real gambling provider.
 */
async function seedPartnerProviders(prisma: PrismaClient): Promise<void> {
  await prisma.partnerProvider.upsert({
    where: { name: 'mock-partner' },
    update: {
      baseUrl: 'https://partner.example.com',
      deepLinkTemplate: '/sport/{sportSlug}/competition/{competitionSlug}/event/{externalEventId}',
      status: 'ACTIVE',
    },
    create: {
      name: 'mock-partner',
      baseUrl: 'https://partner.example.com',
      deepLinkTemplate: '/sport/{sportSlug}/competition/{competitionSlug}/event/{externalEventId}',
      status: 'ACTIVE',
    },
  });

  console.log('Seed complete: partner providers provisioned (mock data only).');
}

async function seedSportsCatalog(prisma: PrismaClient): Promise<void> {
  for (const sportSeed of SPORTS_CATALOG) {
    const sport = await prisma.sport.upsert({
      where: { slug: sportSeed.slug },
      update: {
        name: sportSeed.name,
        description: sportSeed.description,
        icon: sportSeed.icon,
        status: sportSeed.status,
        sortOrder: sportSeed.sortOrder,
      },
      create: {
        name: sportSeed.name,
        slug: sportSeed.slug,
        description: sportSeed.description,
        icon: sportSeed.icon,
        status: sportSeed.status,
        sortOrder: sportSeed.sortOrder,
      },
    });

    for (const gameSeed of sportSeed.games) {
      const game = await prisma.game.upsert({
        where: { slug: gameSeed.slug },
        update: {
          sportId: sport.id,
          name: gameSeed.name,
          description: gameSeed.description,
          status: gameSeed.status,
          sortOrder: gameSeed.sortOrder,
        },
        create: {
          sportId: sport.id,
          name: gameSeed.name,
          slug: gameSeed.slug,
          description: gameSeed.description,
          status: gameSeed.status,
          sortOrder: gameSeed.sortOrder,
        },
      });

      await prisma.gameAvailability.upsert({
        where: { gameId: game.id },
        update: { gamblingEnabled: gameSeed.gamblingEnabled },
        create: { gameId: game.id, gamblingEnabled: gameSeed.gamblingEnabled },
      });

      if (gameSeed.providerMapping) {
        await prisma.providerMapping.upsert({
          where: { gameId: game.id },
          update: {
            providerName: gameSeed.providerMapping.providerName,
            externalGameId: gameSeed.providerMapping.externalGameId,
            status: gameSeed.providerMapping.status,
          },
          create: {
            gameId: game.id,
            providerName: gameSeed.providerMapping.providerName,
            externalGameId: gameSeed.providerMapping.externalGameId,
            status: gameSeed.providerMapping.status,
          },
        });
      }
    }
  }

  console.log('Seed complete: sports/games catalog provisioned (mock data only).');
}
// ---------------------------------------------------------------------------
// Phase 5 — Betting domain seed (clearly fake, development-only data).
//
// Covers the coverage matrix required for betting tests:
//   events:    SCHEDULED (evt-1001) | LIVE (evt-1002) | SUSPENDED (evt-sus-1)
//              | FINISHED (evt-fin-1)
//   markets:   OPEN (Match Winner) | SUSPENDED (Total Goals) | CLOSED
//   selections: ACTIVE selections with odds | one INACTIVE selection (No Goal)
//   games:     gambling-enabled (football-premier-league-winner) and a
//              non-gambling game (see SPORTS_CATALOG above) which deliberately
//              has no events so it can never be bet on.
//
// Provider references mirror the MockProvider catalog (packages/integrations)
// so a dev bet on evt-1001 can actually be accepted by the mock operator.
// ---------------------------------------------------------------------------

interface SeedSelection {
  name: string;
  providerSelectionId: string;
  status: 'ACTIVE' | 'INACTIVE';
  price?: string;
}
interface SeedMarket {
  name: string;
  status: 'OPEN' | 'SUSPENDED' | 'CLOSED';
  selections: SeedSelection[];
}
interface SeedEvent {
  providerEventId: string;
  name: string;
  startTime: string;
  status: 'SCHEDULED' | 'LIVE' | 'SUSPENDED' | 'FINISHED' | 'CANCELLED';
  /** Competition slug (sports-hub model) this event belongs to. */
  competitionSlug?: string;
  markets: SeedMarket[];
}

// providerEventId values align with the MockProvider fixture catalog.
const BETTING_EVENTS: SeedEvent[] = [
  {
    providerEventId: 'evt-1001',
    name: 'Alpha United v Beta City',
    startTime: new Date(Date.now() + 86_400_000).toISOString(),
    status: 'SCHEDULED',
    competitionSlug: 'premier-league',
    markets: [
      {
        name: 'Match Winner',
        status: 'OPEN',
        selections: [
          { name: 'Home', providerSelectionId: 'evt-1001-sel-home', status: 'ACTIVE', price: '1.85' },
          { name: 'Draw', providerSelectionId: 'evt-1001-sel-draw', status: 'ACTIVE', price: '3.40' },
          { name: 'Away', providerSelectionId: 'evt-1001-sel-away', status: 'ACTIVE', price: '4.20' },
        ],
      },
    ],
  },
  {
    providerEventId: 'evt-1002',
    name: 'Gamma Rovers v Delta FC',
    startTime: new Date(Date.now() + 3_600_000).toISOString(),
    status: 'LIVE',
    competitionSlug: 'premier-league',
    markets: [
      {
        name: 'Match Winner',
        status: 'OPEN',
        selections: [
          { name: 'Home', providerSelectionId: 'evt-1002-sel-home', status: 'ACTIVE', price: '2.10' },
          { name: 'Draw', providerSelectionId: 'evt-1002-sel-draw', status: 'ACTIVE', price: '3.20' },
          { name: 'Away', providerSelectionId: 'evt-1002-sel-away', status: 'ACTIVE', price: '3.55' },
        ],
      },
    ],
  },
  {
    providerEventId: 'evt-sus-1',
    name: 'Suspended Derby',
    startTime: new Date(Date.now() + 48 * 3_600_000).toISOString(),
    status: 'SUSPENDED',
    competitionSlug: 'premier-league',
    markets: [
      {
        name: 'Total Goals',
        status: 'SUSPENDED',
        selections: [
          { name: 'Over 2.5', providerSelectionId: 'evt-sus-1-sel-over', status: 'ACTIVE', price: '1.95' },
          { name: 'Under 2.5', providerSelectionId: 'evt-sus-1-sel-under', status: 'ACTIVE', price: '1.85' },
          // Deliberately INACTIVE selection (never bettable).
          { name: 'No Goal', providerSelectionId: 'evt-sus-1-sel-none', status: 'INACTIVE' },
        ],
      },
    ],
  },
  {
    providerEventId: 'evt-fin-1',
    name: 'Finished Classic',
    startTime: new Date(Date.now() - 24 * 3_600_000).toISOString(),
    status: 'FINISHED',
    competitionSlug: 'premier-league',
    markets: [
      {
        name: 'Match Winner',
        status: 'CLOSED',
        selections: [
          { name: 'Home', providerSelectionId: 'evt-fin-1-sel-home', status: 'ACTIVE', price: '1.50' },
        ],
      },
    ],
  },
];

/**
 * Seeds the betting domain under every GAMBLING-ENABLED game that has an
 * ACTIVE mock provider mapping. Non-gambling games intentionally get no events.
 */
async function seedBettingDomain(prisma: PrismaClient): Promise<void> {
  const games = await prisma.game.findMany({
    where: {
      status: 'ACTIVE',
      availability: { gamblingEnabled: true },
      providerMapping: { status: 'ACTIVE' },
    },
  });

  // Only seed the fixture catalog against the football gambling game so that
  // provider references line up with the mock catalog.
  const footballGame = games.find((g) => g.slug === 'football-premier-league-winner');
  if (!footballGame) {
    console.log('Seed: no gambling-enabled football game found; skipping betting domain.');
    return;
  }

  for (const eventSeed of BETTING_EVENTS) {
    // Sports-hub model: every event belongs to a competition.
    const competition = eventSeed.competitionSlug
      ? await prisma.competition.findFirst({ where: { slug: eventSeed.competitionSlug, status: 'ACTIVE' } })
      : null;
    const event = await prisma.event.upsert({
      where: {
        gameId_providerEventId: {
          gameId: footballGame.id,
          providerEventId: eventSeed.providerEventId,
        },
      },
      update: {
        name: eventSeed.name,
        startTime: new Date(eventSeed.startTime),
        status: eventSeed.status,
        competitionId: competition?.id ?? null,
      },
      create: {
        gameId: footballGame.id,
        providerEventId: eventSeed.providerEventId,
        name: eventSeed.name,
        startTime: new Date(eventSeed.startTime),
        status: eventSeed.status,
        competitionId: competition?.id ?? null,
        bettingMode: 'NATIVE',
      },
    });

    for (const marketSeed of eventSeed.markets) {
      const market = await prisma.market.upsert({
        where: { eventId_name: { eventId: event.id, name: marketSeed.name } },
        update: { status: marketSeed.status },
        create: { eventId: event.id, name: marketSeed.name, status: marketSeed.status },
      });

      for (const selectionSeed of marketSeed.selections) {
        const selection = await prisma.selection.upsert({
          where: {
            marketId_providerSelectionId: {
              marketId: market.id,
              providerSelectionId: selectionSeed.providerSelectionId,
            },
          },
          update: { name: selectionSeed.name, status: selectionSeed.status },
          create: {
            marketId: market.id,
            name: selectionSeed.name,
            providerSelectionId: selectionSeed.providerSelectionId,
            status: selectionSeed.status,
          },
        });

        if (selectionSeed.price !== undefined) {
          await prisma.odds.upsert({
            where: { selectionId: selection.id },
            update: { price: selectionSeed.price },
            create: { selectionId: selection.id, price: selectionSeed.price },
          });
        }
      }
    }
  }

  console.log('Seed complete: betting domain provisioned (mock data only).');
}

/**
 * Seeds PARTNER events (cricket IPL/BPL/PSL) that redirect to the mock
 * partner platform. These events are NOT bettable through the TANVIONROYALE local
 * betting engine — the backend marks them PARTNER and the frontend shows
 * [Open Match] instead of the local bet slip.
 */
async function seedPartnerEvents(prisma: PrismaClient): Promise<void> {
  const partner = await prisma.partnerProvider.findUnique({ where: { name: 'mock-partner' } });
  if (!partner) {
    console.log('Seed: no partner provider found; skipping partner events.');
    return;
  }

  const cricket = await prisma.sport.findUnique({ where: { slug: 'cricket' } });
  if (!cricket) {
    console.log('Seed: no cricket sport found; skipping partner events.');
    return;
  }

  const cricketGame = await prisma.game.findFirst({
    where: { sportId: cricket.id, status: 'ACTIVE' },
  });
  if (!cricketGame) {
    console.log('Seed: no cricket game found; skipping partner events.');
    return;
  }

  const competitions = await prisma.competition.findMany({
    where: { sportId: cricket.id, status: 'ACTIVE' },
  });
  const ipl = competitions.find((c) => c.slug === 'ipl');
  const bpl = competitions.find((c) => c.slug === 'bpl');
  const psl = competitions.find((c) => c.slug === 'psl');

  const now = Date.now();
  const hour = 3_600_000;
  const day = 86_400_000;

  const partnerEvents = [
    {
      providerEventId: 'evt-2001',
      name: 'Mumbai Indians v Chennai Super Kings',
      competitionId: ipl?.id ?? null,
      homeName: 'Mumbai Indians',
      awayName: 'Chennai Super Kings',
      startTime: new Date(now + 3 * hour),
      status: 'LIVE' as const,
      live: true,
      externalEventId: 'evt-2001',
    },
    {
      providerEventId: 'evt-2002',
      name: 'Royal Challengers Bengaluru v Kolkata Knight Riders',
      competitionId: ipl?.id ?? null,
      homeName: 'Royal Challengers Bengaluru',
      awayName: 'Kolkata Knight Riders',
      startTime: new Date(now + 2 * day),
      status: 'SCHEDULED' as const,
      live: false,
      externalEventId: 'evt-2002',
    },
    {
      providerEventId: 'evt-2003',
      name: 'Dhaka Dominators v Chattogram Challengers',
      competitionId: bpl?.id ?? null,
      homeName: 'Dhaka Dominators',
      awayName: 'Chattogram Challengers',
      startTime: new Date(now + 5 * hour),
      status: 'LIVE' as const,
      live: true,
      externalEventId: 'evt-2003',
    },
    {
      providerEventId: 'evt-2004',
      name: 'Sylhet Strikers v Khulna Tigers',
      competitionId: bpl?.id ?? null,
      homeName: 'Sylhet Strikers',
      awayName: 'Khulna Tigers',
      startTime: new Date(now + 3 * day),
      status: 'SCHEDULED' as const,
      live: false,
      externalEventId: 'evt-2004',
    },
    {
      providerEventId: 'evt-2005',
      name: 'Lahore Qalandars v Karachi Kings',
      competitionId: psl?.id ?? null,
      homeName: 'Lahore Qalandars',
      awayName: 'Karachi Kings',
      startTime: new Date(now + 6 * hour),
      status: 'LIVE' as const,
      live: true,
      externalEventId: 'evt-2005',
    },
    {
      providerEventId: 'evt-2006',
      name: 'Islamabad United v Peshawar Zalmi',
      competitionId: psl?.id ?? null,
      homeName: 'Islamabad United',
      awayName: 'Peshawar Zalmi',
      startTime: new Date(now + 4 * day),
      status: 'SCHEDULED' as const,
      live: false,
      externalEventId: 'evt-2006',
    },
  ];

  for (const evt of partnerEvents) {
    await prisma.event.upsert({
      where: {
        gameId_providerEventId: {
          gameId: cricketGame.id,
          providerEventId: evt.providerEventId,
        },
      },
      update: {
        name: evt.name,
        competitionId: evt.competitionId,
        homeName: evt.homeName,
        awayName: evt.awayName,
        startTime: evt.startTime,
        status: evt.status,
        live: evt.live,
        bettingMode: 'PARTNER',
        externalEventId: evt.externalEventId,
        partnerProviderId: partner.id,
      },
      create: {
        gameId: cricketGame.id,
        providerEventId: evt.providerEventId,
        name: evt.name,
        competitionId: evt.competitionId,
        homeName: evt.homeName,
        awayName: evt.awayName,
        startTime: evt.startTime,
        status: evt.status,
        live: evt.live,
        bettingMode: 'PARTNER',
        externalEventId: evt.externalEventId,
        partnerProviderId: partner.id,
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Paper-trading demo instruments (clearly virtual; prices are DEMO anchors).
  // ---------------------------------------------------------------------------
  const tradingInstruments = [
    { symbol: 'AAPL', name: 'Apple Inc.', type: 'STOCK', basePrice: 15234, sortOrder: 10 },
    { symbol: 'TSLA', name: 'Tesla Inc.', type: 'STOCK', basePrice: 32768, sortOrder: 20 },
    { symbol: 'NVDA', name: 'NVIDIA Corp.', type: 'STOCK', basePrice: 11284, sortOrder: 30 },
    { symbol: 'AMZN', name: 'Amazon.com Inc.', type: 'STOCK', basePrice: 18612, sortOrder: 40 },
    { symbol: 'BTCUSD', name: 'Bitcoin', type: 'CRYPTO', basePrice: 6125000, sortOrder: 50 },
    { symbol: 'ETHUSD', name: 'Ethereum', type: 'CRYPTO', basePrice: 312890, sortOrder: 60 },
    { symbol: 'EURUSD', name: 'Euro / US Dollar', type: 'FOREX', basePrice: 10850, sortOrder: 70 },
    { symbol: 'GBPUSD', name: 'British Pound / US Dollar', type: 'FOREX', basePrice: 12690, sortOrder: 80 },
    { symbol: 'XAUUSD', name: 'Gold Spot / US Dollar', type: 'COMMODITY', basePrice: 215400, sortOrder: 90 },
    { symbol: 'XBRUSD', name: 'Brent Crude', type: 'COMMODITY', basePrice: 82910, sortOrder: 100 },
  ] as const;

  for (const inst of tradingInstruments) {
    await prisma.tradingInstrument.upsert({
      where: { symbol: inst.symbol },
      update: {
        name: inst.name,
        type: inst.type as never,
        basePrice: inst.basePrice,
        sortOrder: inst.sortOrder,
      },
      create: {
        symbol: inst.symbol,
        name: inst.name,
        type: inst.type as never,
        basePrice: inst.basePrice,
        sortOrder: inst.sortOrder,
        dataSource: 'DEMO',
      },
    });
  }

  console.log(
    'Seed complete: partner events provisioned (mock data only) and paper-trading DEMO instruments seeded.',
  );
}
