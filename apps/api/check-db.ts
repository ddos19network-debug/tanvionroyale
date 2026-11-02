import { PrismaClient } from '@prisma/client';

async function main() {
  console.log('ENV DATABASE_URL=', process.env.DATABASE_URL?.slice(0, 80));
  const p = new PrismaClient();
  await p.$connect();
  const row = await p.$queryRawUnsafe<{ current_database: string; current_user: string }[]>(
    'select current_database() as current_database, current_user as current_user',
  );
  console.log('CONNECTED TO:', JSON.stringify(row));
  await p.$disconnect();
}

void main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
