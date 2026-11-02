import { NestFactory } from "@nestjs/core";
import { IoAdapter } from "@nestjs/platform-socket.io";
import { ValidationPipe, VersioningType, Logger } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import helmet from "helmet";
import { json, urlencoded } from "express";
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { AppModule } from "./app.module";
import { captureRawBody } from "./common/middleware/raw-body.middleware";
import { readNodeEnv } from "@tanvion-royale/config";
import { resolveCorsOrigins } from "./config/cors";
import { validateProductionSecrets } from "./config/production-secrets";

/**
 * The global URL prefix every route lives under (`/api/v1/…`). Named so the
 * route-scoped raw-body capture below cannot drift from the real callback path.
 */
const API_PREFIX = "api";

/**
 * Pin the Prisma query-engine library to the stable copy kept in
 * `apps/api/prisma-engine/` — outside `dist/` (wiped by Nest's
 * `deleteOutDir` on every build/watch start) and outside the `prisma generate`
 * output directory (`src/generated/prisma/`, unconditionally rewritten by the
 * generator). Windows keeps a loaded engine DLL memory-mapped, so loading it
 * from either of those locations caused
 * `EPERM: operation not permitted, unlink '...dist\generated\prisma\query_engine-windows.dll.node'`
 * whenever a build, watch restart, or client regeneration ran while the API
 * was up.
 *
 * `prisma:generate` (prisma-copy-binary.cjs) hash-syncs the engine into
 * `prisma-engine/`, so the file this process loads is only ever rewritten
 * when the engine bytes themselves change (i.e. a Prisma upgrade, which
 * requires a restart anyway).
 *
 * No-ops when `PRISMA_QUERY_ENGINE_LIBRARY` is already set (explicit
 * operator override wins) or when `prisma-engine/` has not been populated yet
 * (fresh clone before `pnpm install` finishes) — Prisma then falls back to
 * its default resolution, which finds the engine next to the generated
 * client.
 */
function pinPrismaQueryEngine(): void {
  if (process.env.PRISMA_QUERY_ENGINE_LIBRARY) {
    return;
  }
  const engineDir = resolve(__dirname, "..", "prisma-engine");
  if (!existsSync(engineDir)) {
    return;
  }
  const engine = readdirSync(engineDir).find(
    (file) => file.includes("query_engine") && file.endsWith(".node"),
  );
  if (!engine) {
    return;
  }
  process.env.PRISMA_QUERY_ENGINE_LIBRARY = join(engineDir, engine);
}

async function bootstrap(): Promise<void> {
  pinPrismaQueryEngine();
  const env = readNodeEnv();
  const logger = new Logger("Bootstrap");
  // HARD GATE: production must refuse to start with missing/placeholder
  // secrets (DATABASE_URL / JWT_SECRET / ENCRYPTION_KEY). Never an insecure
  // default — see config/production-secrets.ts.
  validateProductionSecrets();

  // rawBody is required for partner webhook HMAC verification over the exact
  // bytes the provider sent (never a re-serialized object).
  const app = await NestFactory.create(AppModule, { rawBody: true });

  // Graceful shutdown on SIGINT/SIGTERM (Ctrl+C): Nest then runs
  // onModuleDestroy on every provider — PrismaService and
  // SecondaryPrismaService call $disconnect() — and disposes the socket.io
  // server (socketModule.close() -> IoAdapter.close()) plus the HTTP
  // listener, so port 3000 is released and no connection is left dangling.
  app.enableShutdownHooks();

  // Socket.io adapter for the crash-game WebSocket namespace (/games/crash).
  // Shares the HTTP server port; JWT authentication is enforced in the gateway.
  app.useWebSocketAdapter(new IoAdapter(app));

  // Security headers
  app.use(helmet());

  // "Report a Problem" screenshots travel as base64 data URLs in JSON (the
  // same pattern as the wallet proof-of-payment upload). The spec allows up
  // to 5MB decoded (~7MB on the wire), so the JSON parser must accept ~10MB.
  // Every other endpoint is unaffected — DTO/service validators still cap
  // each field individually.
  //
  // `verify: captureRawBody` is REQUIRED, not cosmetic: these parsers run
  // BEFORE Nest's own rawBody-enabled parsers (which are registered at
  // app.init()), and body-parser never re-reads an already-consumed stream, so
  // without this hook `req.rawBody` stayed undefined and every HMAC-signed
  // provider callback (WinHouse/BigBang balance-change) was rejected with 400
  // malformed_body — the "real bet works in the UI but never reaches the
  // wallet" failure. See common/middleware/raw-body.middleware.ts.
  app.use(json({ limit: '10mb', verify: captureRawBody }));
  app.use(urlencoded({ limit: '10mb', extended: true, verify: captureRawBody }));

  // Belt-and-braces for the ONE unauthenticated, HMAC-signed provider route.
  // WinHouse labels the body itself, and a provider sending a different (or
  // missing) Content-Type would otherwise reach the controller with no bytes to
  // verify — refusing every stake. `type: () => true` captures the exact bytes
  // whatever the label says, on THIS route only; a JSON body is still the only
  // thing the route accepts, so nothing else changes.
  app.use(
    `/${API_PREFIX}/v1/winhouse/balance-change`,
    json({ type: () => true, limit: '10mb', verify: captureRawBody }),
  );

  // BigBang's webhook. Same reasoning as above (HMAC over the exact bytes, and
  // the provider's Content-Type is not ours to dictate), but with a TIGHT size
  // limit: a webhook event is a small notification, not a file upload, so a
  // bounded body keeps an internet-facing, signature-verified route from being
  // turned into a memory-exhaustion vector. `verify: captureRawBody` is what
  // makes `req.rawBody` the exact signed message.
  app.use(
    `/${API_PREFIX}/v1/bigbang/webhooks`,
    json({ type: () => true, limit: '256kb', verify: captureRawBody }),
  );

  // CORS — explicit allow-list of the web app origin(s) (CORS_ORIGIN env,
  // comma-separated). Never a wildcard: every response carries credentials.
  const corsOrigin = resolveCorsOrigins();
  if (typeof corsOrigin === "boolean") {
    logger.warn(
      "CORS_ORIGIN is not set - reflecting any request origin (development only).",
    );
  } else {
    logger.log(`CORS allowed origins: ${corsOrigin.join(", ")}`);
    if (env === "production" && !process.env.CORS_ORIGIN?.trim()) {
      logger.warn(
        "CORS_ORIGIN is not set; using the built-in production origin allow-list.",
      );
    }
  }

  app.enableCors({
    origin: corsOrigin,
    credentials: true,
    // Explicit methods + headers so OPTIONS preflight responses are
    // deterministic behind proxies/CDNs (Render/Cloudflare) instead of
    // relying on echoing. GET covers GET /auth/google (+ callback redirect
    // landing); POST covers /auth/login, /auth/refresh and the one-time
    // POST /auth/oauth/exchange.
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    // Explicit allow-list so OPTIONS preflight responses are deterministic
    // behind proxies/CDNs (Render/Cloudflare) instead of relying on echoing.
    allowedHeaders: ["Content-Type", "Authorization"],
  });

  // Global URL prefix + versioning: /api/v1/...
  app.setGlobalPrefix(API_PREFIX);
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: "1",
  });

  // Global validation (class-validator DTOs)
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // OpenAPI / Swagger (development + non-production)
  const swaggerEnabled =
    env !== "production" || process.env.ENABLE_SWAGGER === "true";
  if (swaggerEnabled) {
    const config = new DocumentBuilder()
      .setTitle("TANVIONROYALE API")
      .setDescription(
        "NestJS backend for the TANVIONROYALE sportsbook platform.",
      )
      .setVersion("0.1.0")
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup("docs", app, document, {
      swaggerOptions: { persistAuthorization: true },
    });
  }

  // Prefer Render's PORT, then API_PORT, then fall back to 3000.
  const rawPort = process.env.PORT ?? process.env.API_PORT ?? "3000";
  const port = Number.parseInt(rawPort, 10);
  if (Number.isNaN(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port: ${rawPort}`);
  }
  try {
    await app.listen(port, "0.0.0.0");
  } catch (error) {
    // Friendly failure for the common "old dev process still running" case:
    // a short actionable message and exit code 1 — never a raw stack trace.
    if ((error as NodeJS.ErrnoException)?.code === "EADDRINUSE") {
      logger.error(
        [
          `Port ${port} is already in use — an old API/node process is still running (or the API was started twice).`,
          `  Find it (Windows): netstat -ano | findstr :${port}`,
          `  Stop it (Windows): taskkill /PID <pid> /F   (or run: pnpm ports:free)`,
        ].join("\n"),
      );
      process.exit(1);
    }
    throw error;
  }
  logger.log(
    `TANVIONROYALE API listening on http://localhost:${port}/api/v1 (env=${env})`,
  );
  if (swaggerEnabled) {
    logger.log(`Swagger UI available at http://localhost:${port}/docs`);
  }
}

void bootstrap();

