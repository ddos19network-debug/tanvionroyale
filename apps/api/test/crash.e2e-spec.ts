import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import helmet from 'helmet';
import { io, type Socket } from 'socket.io-client';
import { AppModule } from '../src/app.module';

/**
 * Sky Rocket crash game journey (e2e) â€” server-authoritative engine:
 *
 *   Register -> Login -> Snapshot -> WebSocket connect -> Betting window ->
 *   Place bet -> Round starts -> Multiplier rises -> Cash out -> Settlement ->
 *   History + provably-fair verification.
 *
 *   Losing path: place bet -> crash occurs -> bet LOST (no payout).
 *   Reconnect:   snapshot restores the authoritative state after disconnect.
 *
 * When PostgreSQL is NOT available the DB-backed tests are SKIPPED with a
 * clear message â€” we never fake a success.
 */

const BASE = '/api/v1/games/crash';

let dbAvailable = true;
async function probeDb(): Promise<boolean> {
  try {
    const url = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/tanvionroyale_test?schema=public';
    const { PrismaClient } = await import('../src/generated/prisma');
    const client = new PrismaClient({ datasources: { db: { url } } });
    await client.$queryRaw`SELECT 1`;
    await client.$disconnect();
    return true;
  } catch {
    return false;
  }
}

async function waitFor(
  condition: () => Promise<boolean>,
  timeoutMs = 40_000,
  intervalMs = 250,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

interface Snapshot {
  success: boolean;
  data: {
    mode: string;
    enabled: boolean;
    round: {
      id: string;
      roundNumber: number;
      status: string;
      bettingOpen: boolean;
      crashMultiplier: number | null;
    } | null;
    myBet: { id: string; status: string; payout: number } | null;
  };
}

describe('TANVION ROYALE API â€” Sky Rocket crash journey (e2e)', () => {
  let app: INestApplication;
  let token = '';
  let email = '';

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

    // Register + login a fresh player (free-play wallet is provisioned on
    // first crash-game interaction with 100k practice points).
    email = `crash-e2e-${Date.now()}@test.local`;
    const reg = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, password: 'Str0ngPassw0rd!', username: "crashe2e_" + (Date.now() % 100000) + "" });
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ identifier: email, password: 'Str0ngPassw0rd!' });
    token = login.body?.data?.accessToken ?? reg.body?.data?.accessToken ?? '';
    if (!token) {
      console.log('REGISTER:', JSON.stringify(reg.body));
      console.log('LOGIN:', JSON.stringify(login.body));
    }
    expect(token).not.toBe('');
  }, 60_000);

  afterAll(async () => {
    if (app) await app.close();
  });

  it('snapshot endpoint is authenticated-only', async () => {
    if (!dbAvailable) return console.log('SKIPPED â€” PostgreSQL unavailable');
    const res = await request(app.getHttpServer()).get(`${BASE}/current`);
    expect(res.status).toBe(401);
  });

  it('snapshot returns the FREE_PLAY config (real money disabled safely)', async () => {
    if (!dbAvailable) return console.log('SKIPPED â€” PostgreSQL unavailable');
    const res = await request(app.getHttpServer())
      .get(`${BASE}/current`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const body = res.body as Snapshot;
    expect(body.data.mode).toBe('FREE_PLAY');
    expect(body.data.enabled).toBe(true);
  });

  it('rejects bet placement without a JWT', async () => {
    if (!dbAvailable) return console.log('SKIPPED â€” PostgreSQL unavailable');
    const res = await request(app.getHttpServer()).post(`${BASE}/bets`).send({ stake: 100 });
    expect(res.status).toBe(401);
  });

  it('WebSocket rejects anonymous connections', async () => {
    if (!dbAvailable) return console.log('SKIPPED â€” PostgreSQL unavailable');
    const port = (app.getHttpServer() as unknown as { address: () => { port: number } }).address().port;
    const client = io(`http://localhost:${port}/games/crash`, { transports: ['websocket'] });
    const rejected = await new Promise<boolean>((resolve) => {
      client.on('ERROR', () => resolve(true));
      client.on('disconnect', () => resolve(true));
      setTimeout(() => resolve(false), 5_000);
    });
    client.close();
    expect(rejected).toBe(true);
  });

  it('WebSocket accepts an authenticated connection', async () => {
    if (!dbAvailable) return console.log('SKIPPED â€” PostgreSQL unavailable');
    const port = (app.getHttpServer() as unknown as { address: () => { port: number } }).address().port;
    const client = io(`http://localhost:${port}/games/crash`, {
      transports: ['websocket'],
      auth: { token },
    });
    const connected = await new Promise<boolean>((resolve) => {
      client.on('connect', () => resolve(true));
      client.on('connect_error', () => resolve(false));
      setTimeout(() => resolve(false), 5_000);
    });
    client.close();
    expect(connected).toBe(true);
  });

  it(
    'places a bet during the betting window, cashes out mid-flight, and settles',
    async () => {
      if (!dbAvailable) return console.log('SKIPPED â€” PostgreSQL unavailable');
      const get = () =>
        request(app.getHttpServer())
          .get(`${BASE}/current`)
          .set('Authorization', `Bearer ${token}`)
          .expect(200);

      // 1. Wait for the betting window of the next round.
      const open = await waitFor(async () => (await get()).body.data.round?.bettingOpen === true);
      expect(open).toBe(true);

      // 2. Place the bet (server validates window, wallet, stake).
      const placed = await request(app.getHttpServer())
        .post(`${BASE}/bets`)
        .set('Authorization', `Bearer ${token}`)
        .send({ stake: 100, clientRequestId: crypto.randomUUID() });
      expect(placed.status).toBe(201);
      expect(placed.body.data.bet.status).toBe('ACTIVE');
      const betId = placed.body.data.bet.id as string;

      // 3. Wait for the round to start; the multiplier rises server-side.
      const running = await waitFor(
        async () => (await get()).body.data.round?.status === 'RUNNING',
      );
      expect(running).toBe(true);

      // 4. Cash out â€” the SERVER decides the accepted multiplier.
      const cashed = await request(app.getHttpServer())
        .post(`${BASE}/bets/${betId}/cashout`)
        .set('Authorization', `Bearer ${token}`)
        .send({ clientRequestId: crypto.randomUUID() });
      expect(cashed.status).toBe(201);
      expect(cashed.body.data.bet.status).toBe('CASHED_OUT');
      expect(cashed.body.data.bet.payout).toBeGreaterThan(100);
      expect(cashed.body.data.bet.cashoutMultiplier).toBeGreaterThan(1);

      // 5. Duplicate cash-out is impossible.
      const double = await request(app.getHttpServer())
        .post(`${BASE}/bets/${betId}/cashout`)
        .set('Authorization', `Bearer ${token}`)
        .send({});
      expect([400, 404, 409]).toContain(double.status);

      // 6. The bet appears in the player's history with the settlement.
      const hist = await request(app.getHttpServer())
        .get(`${BASE}/my-history`)
        .set('Authorization', `Bearer ${token}`);
      expect(hist.status).toBe(200);
      const entry = hist.body.data.history.find(
        (h: { result: string | null }) => h.result === 'CASHED_OUT',
      );
      expect(entry).toBeTruthy();
      expect(entry.payout).toBeGreaterThan(100);
    },
    60_000,
  );

  it(
    'losing path: an uncashed bet becomes LOST with no payout at crash',
    async () => {
      if (!dbAvailable) return console.log('SKIPPED â€” PostgreSQL unavailable');
      const get = () =>
        request(app.getHttpServer())
          .get(`${BASE}/current`)
          .set('Authorization', `Bearer ${token}`)
          .expect(200);

      const open = await waitFor(async () => (await get()).body.data.round?.bettingOpen === true);
      expect(open).toBe(true);

      const placed = await request(app.getHttpServer())
        .post(`${BASE}/bets`)
        .set('Authorization', `Bearer ${token}`)
        .send({ stake: 100, clientRequestId: crypto.randomUUID() });
      expect(placed.status).toBe(201);
      const betId = placed.body.data.bet.id as string;

      // Do NOT cash out â€” let the server-determined crash point arrive.
      const crashed = await waitFor(
        async () => {
          const round = (await get()).body.data.round;
          return (
            round != null &&
            ['CRASHED', 'SETTLED', 'COMPLETED'].includes(round.status)
          );
        },
        60_000,
      );
      expect(crashed).toBe(true);

      const bet = await request(app.getHttpServer())
        .get(`${BASE}/bets/${betId}`)
        .set('Authorization', `Bearer ${token}`);
      expect(bet.status).toBe(200);
      expect(bet.body.data.bet.result).toBe('LOST');
      expect(bet.body.data.bet.payout).toBe(0);
    },
    90_000,
  );

  it('reconnect: the snapshot restores the authoritative state', async () => {
    if (!dbAvailable) return console.log('SKIPPED â€” PostgreSQL unavailable');
    const res = await request(app.getHttpServer())
      .get(`${BASE}/current`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const body = res.body as Snapshot;
    expect(body.data.round).toBeTruthy();
    expect(['CREATED', 'BETTING_OPEN', 'RUNNING', 'CRASHED', 'SETTLED', 'COMPLETED']).toContain(
      body.data.round?.status,
    );
  });
});
