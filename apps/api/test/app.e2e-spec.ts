import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import helmet from 'helmet';
import { AppModule } from '../src/app.module';

/**
 * E2E smoke tests. These boot the real AppModule without a database
 * (Prisma connection failures are tolerated outside production) and verify
 * the core HTTP contract: prefix, versioning, health and response envelope.
 */
describe('TANVIONROYALE API (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(helmet());
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/v1 returns API metadata', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.name).toBe('TANVIONROYALE API');
  });

  it('GET /api/v1/health returns a health payload with db check', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.service).toBe('tanvion-royale-api');
    expect(res.body.data.checks).toHaveProperty('db');
    expect(['up', 'down']).toContain(res.body.data.checks.db);
  });

  it('rejects invalid registration payloads with 400 (never reaches the DB)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email: 'not-an-email', username: 'x!', password: 'short' });
    expect(res.status).toBe(400);
  });

  it('rejects unknown routes with 404 under the versioned prefix', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/does-not-exist');
    expect(res.status).toBe(404);
  });
});