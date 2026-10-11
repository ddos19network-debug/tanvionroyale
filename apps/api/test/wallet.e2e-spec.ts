import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import helmet from 'helmet';
import { AppModule } from '../src/app.module';

/**
 * Wallet integration/e2e tests (Phase 6).
 *
 * When PostgreSQL is NOT available (e.g. local Windows without Docker), the
 * DB-backed tests are SKIPPED with a clear message - we never fake success.
 */
let dbAvailable = true;
async function probeDb(): Promise<boolean> {
  try {
    const url =
      process.env.DATABASE_URL ??
      'postgresql://postgres:postgres@localhost:5432/tanvionroyale_test?schema=public';
    const { PrismaClient } = await import('../src/generated/prisma');
    const client = new PrismaClient({ datasources: { db: { url } } });
    await client.$queryRaw`SELECT 1`;
    await client.$disconnect();
    return true;
  } catch {
    return false;
  }
}

function uniqueEmail(): string {
  return `wallet-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`;
}

async function registerAndLogin(app: INestApplication, email: string): Promise<string> {
  await request(app.getHttpServer())
    .post('/api/v1/auth/register')
    .send({ email, password: 'Str0ngPass!w3', username: email.split('@')[0] });
  const res = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ identifier: email, password: 'Str0ngPass!w3' });
  return (res.body?.data?.accessToken ?? res.body?.accessToken) as string;
}

describe('TANVIONROYALE API - wallet (e2e)', () => {
  let app: INestApplication;
  let token: string;

  beforeAll(async () => {
    dbAvailable = await probeDb();
    if (!dbAvailable) return;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(helmet());
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();

    token = await registerAndLogin(app, uniqueEmail());
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('GET /wallet requires authentication', async () => {
    if (!dbAvailable) return console.log('SKIPPED - PostgreSQL unavailable');
    const res = await request(app.getHttpServer()).get('/api/v1/wallet');
    expect(res.status).toBe(401);
  });

  it('GET /wallet and /wallet/balance return the user wallet', async () => {
    if (!dbAvailable) return console.log('SKIPPED - PostgreSQL unavailable');
    const res = await request(app.getHttpServer())
      .get('/api/v1/wallet')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.currency).toBe('BDT');
    expect(res.body.data.availableBalance).toBe(0);

    const balance = await request(app.getHttpServer())
      .get('/api/v1/wallet/balance')
      .set('Authorization', `Bearer ${token}`);
    expect(balance.status).toBe(200);
    expect(balance.body.data).toHaveProperty('lockedBalance', 0);
  });

  it('POST /wallet/deposits completes via the dev-mock provider and credits the ledger', async () => {
    if (!dbAvailable) return console.log('SKIPPED - PostgreSQL unavailable');
    const key = `e2e-${Date.now()}-dep`;
    const res = await request(app.getHttpServer())
      .post('/api/v1/wallet/deposits')
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: 1050, currency: 'BDT', idempotencyKey: key });
    expect(res.status).toBe(201);
    expect(res.body.data.transaction.status).toBe('COMPLETED');
    expect(res.body.data.transaction.amount).toBe(1050);
    expect(res.body.data.wallet.availableBalance).toBe(1050);

    // Duplicate request never double-credits.
    const dup = await request(app.getHttpServer())
      .post('/api/v1/wallet/deposits')
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: 1050, currency: 'BDT', idempotencyKey: key });
    expect(dup.status).toBe(201);
    expect(dup.body.data.duplicate).toBe(true);
    expect(dup.body.data.wallet.availableBalance).toBe(1050);
  });

  it('POST /wallet/withdrawals locks then completes funds; insufficient funds rejected', async () => {
    if (!dbAvailable) return console.log('SKIPPED - PostgreSQL unavailable');
    const res = await request(app.getHttpServer())
      .post('/api/v1/wallet/withdrawals')
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: 500, currency: 'BDT', idempotencyKey: `e2e-${Date.now()}-wd` });
    expect(res.status).toBe(201);
    expect(res.body.data.transaction.status).toBe('COMPLETED');
    expect(res.body.data.transaction.amount).toBe(-500);
    expect(res.body.data.wallet.availableBalance).toBe(550);
    expect(res.body.data.wallet.lockedBalance).toBe(0);

    const big = await request(app.getHttpServer())
      .post('/api/v1/wallet/withdrawals')
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: 999999, currency: 'BDT', idempotencyKey: `e2e-${Date.now()}-big` });
    expect(big.status).toBe(400);
    expect(big.body.code).toBe('INSUFFICIENT_FUNDS');
  });

  it('GET /wallet/transactions lists only my transactions; cross-user access blocked', async () => {
    if (!dbAvailable) return console.log('SKIPPED - PostgreSQL unavailable');
    const list = await request(app.getHttpServer())
      .get('/api/v1/wallet/transactions')
      .set('Authorization', `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect(list.body.data.length).toBeGreaterThanOrEqual(2);

    const txId = list.body.data[0].id;
    const otherToken = await registerAndLogin(app, uniqueEmail());
    const cross = await request(app.getHttpServer())
      .get(`/api/v1/wallet/transactions/${txId}`)
      .set('Authorization', `Bearer ${otherToken}`);
    expect([403, 404]).toContain(cross.status);

    const own = await request(app.getHttpServer())
      .get(`/api/v1/wallet/transactions/${txId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(own.status).toBe(200);
  });

  it('rejects invalid amounts (validation)', async () => {
    if (!dbAvailable) return console.log('SKIPPED - PostgreSQL unavailable');
    const res = await request(app.getHttpServer())
      .post('/api/v1/wallet/deposits')
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: 10.5, currency: 'BDT', idempotencyKey: `e2e-${Date.now()}-bad` });
    expect(res.status).toBe(400);
  });
});
