/* Audit script: real provider/catalog counts. Read-only. */
const fs = require('fs');
const path = require('path');

function loadEnv() {
  const file = path.join(__dirname, '..', '.env');
  const text = fs.readFileSync(file, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.trim());
    if (!match) continue;
    let value = match[2].trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    if (!process.env[match[1]]) process.env[match[1]] = value;
  }
}
loadEnv();

const { PrismaClient } = require('../apps/api/src/generated/prisma');

async function main() {
  const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
  try {
    const providers = await prisma.partnerProvider.findMany({
      select: {
        id: true,
        name: true,
        providerCode: true,
        status: true,
        environment: true,
        integrationType: true,
        productTypes: true,
        lastSyncAt: true,
        lastSyncError: true,
      },
      orderBy: { createdAt: 'asc' },
    });
    console.log('PROVIDERS: ' + providers.length);
    for (const p of providers) {
      console.log(JSON.stringify(p));
    }

    const groups = await prisma.casinoGame.groupBy({
      by: ['providerId', 'status', 'productType'],
      _count: { _all: true },
    });
    console.log('GAME GROUPS');
    for (const g of groups) {
      console.log(JSON.stringify(g));
    }

    console.log('TOTAL GAMES = ' + (await prisma.casinoGame.count()));
    console.log('ACTIVE GAMES = ' + (await prisma.casinoGame.count({ where: { status: 'ACTIVE' } })));
    console.log('CASINO ACTIVE = ' + (await prisma.casinoGame.count({ where: { status: 'ACTIVE', productType: 'CASINO' } })));
    console.log('LIVE ACTIVE = ' + (await prisma.casinoGame.count({ where: { status: 'ACTIVE', productType: 'LIVE_CASINO' } })));
    console.log('CATEGORIES = ' + (await prisma.casinoCategory.count()));

    const sample = await prisma.casinoGame.findMany({ take: 3, select: { providerId: true, externalId: true, name: true, productType: true, status: true, raw: true } });
    console.log('SAMPLE');
    for (const s of sample) console.log(JSON.stringify(s));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('AUDIT FAILED: ' + (err && err.message));
  process.exit(1);
});
