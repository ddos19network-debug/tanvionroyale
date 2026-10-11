// Database audit — prints counts only, never connection strings or secrets.
const fs = require('fs');
const path = require('path');

// Load .env into the process (no output of values).
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const { PrismaClient } = require('./apps/api/src/generated/prisma');
const prisma = new PrismaClient();

async function main() {
  const eventsByStatus = await prisma.event.groupBy({ by: ['status'], _count: true });
  const providerRows = await prisma.partnerProvider.findMany({
    select: { name: true, status: true, syncStatus: true, lastSyncAt: true, lastSyncError: true, apiKeyEnc: true, apiSecretEnc: true },
  });
  const counts = {
    sports: await prisma.sport.count(),
    activeSports: await prisma.sport.count({ where: { status: 'ACTIVE' } }),
    sportsList: await prisma.sport.findMany({ select: { name: true, slug: true, status: true, sortOrder: true } }),
    competitions: await prisma.competition.count(),
    games: await prisma.game.count(),
    activeGames: await prisma.game.count({ where: { status: 'ACTIVE' } }),
    gamesByStatus: await prisma.game.groupBy({ by: ['status'], _count: true }),
    gamesList: await prisma.game.findMany({
      select: { name: true, slug: true, status: true, sport: { select: { slug: true } } },
      orderBy: { sortOrder: 'asc' },
    }),
    events: await prisma.event.count(),
    eventsByStatus,
    markets: await prisma.market.count(),
    selections: await prisma.selection.count(),
    odds: await prisma.odds.count(),
    partnerProviders: providerRows.map((p) => ({
      name: p.name,
      status: p.status,
      syncStatus: p.syncStatus,
      lastSyncAt: p.lastSyncAt ? p.lastSyncAt.toISOString() : null,
      lastSyncError: p.lastSyncError,
      apiKeySet: Boolean(p.apiKeyEnc),
      apiSecretSet: Boolean(p.apiSecretEnc),
    })),
    users: await prisma.user.count(),
    roles: await prisma.role.count(),
    gameSessions: await prisma.gameSession.count(),
    gameResults: await prisma.gameResult.count(),
    bets: await prisma.bet.count(),
  };
  console.log(JSON.stringify(counts, null, 2));
}

main().finally(() => prisma.$disconnect());