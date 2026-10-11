-- ============================================================================
-- Payment repair: database-backed gateway configs + gateway link + webhook ops.
--
-- Additive and idempotent: guarded so it is safe against any database state.
--   PaymentGatewayConfig  (admin-managed gateway credentials, encrypted at rest)
--   PaymentMethod.gatewayConfigId (optional link to a gateway config)
--   PaymentGatewayStatus  (ACTIVE | INACTIVE | ARCHIVED)
--   PaymentWebhookEvent   operational columns (RECEIVED/PROCESSED/DUPLICATE/FAILED)
--
-- Secrets are NEVER stored raw by convention (service encrypts with
-- ENCRYPTION_KEY); the API only exposes boolean *Set flags.
-- ============================================================================

-- --- PaymentGatewayStatus enum ---
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PaymentGatewayStatus') THEN
    CREATE TYPE "PaymentGatewayStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');
  END IF;
END $$;
ALTER TYPE "PaymentGatewayStatus" ADD VALUE IF NOT EXISTS 'ACTIVE';
ALTER TYPE "PaymentGatewayStatus" ADD VALUE IF NOT EXISTS 'INACTIVE';
ALTER TYPE "PaymentGatewayStatus" ADD VALUE IF NOT EXISTS 'ARCHIVED';

-- ---------------------------------------------------------------------------
-- PaymentGatewayConfig
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema = 'public' AND table_name = 'PaymentGatewayConfig') THEN
    CREATE TABLE "PaymentGatewayConfig" (
        "id" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "code" TEXT NOT NULL,
        "providerType" TEXT NOT NULL DEFAULT 'generic-http',
        "baseUrl" TEXT NOT NULL,
        "status" "PaymentGatewayStatus" NOT NULL DEFAULT 'ACTIVE',
        "apiKeyEnc" TEXT,
        "apiSecretEnc" TEXT,
        "webhookSecretEnc" TEXT,
        "authMode" TEXT,
        "apiVersion" TEXT,
        "timeoutMs" INTEGER NOT NULL DEFAULT 15000,
        "supportedCurrencies" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
        "depositEnabled" BOOLEAN NOT NULL DEFAULT true,
        "withdrawalEnabled" BOOLEAN NOT NULL DEFAULT true,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL,

        CONSTRAINT "PaymentGatewayConfig_pkey" PRIMARY KEY ("id")
    );
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "PaymentGatewayConfig_name_key" ON "PaymentGatewayConfig"("name");
CREATE UNIQUE INDEX IF NOT EXISTS "PaymentGatewayConfig_code_key" ON "PaymentGatewayConfig"("code");
CREATE INDEX IF NOT EXISTS "PaymentGatewayConfig_status_idx" ON "PaymentGatewayConfig"("status");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='PaymentGatewayConfig' AND column_name='webhookSecretEnc') THEN
    ALTER TABLE "PaymentGatewayConfig" ADD COLUMN "webhookSecretEnc" TEXT;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- PaymentMethod.gatewayConfigId (optional gateway link)
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='PaymentMethod' AND column_name='gatewayConfigId') THEN
    ALTER TABLE "PaymentMethod" ADD COLUMN "gatewayConfigId" TEXT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "PaymentMethod_gatewayConfigId_idx" ON "PaymentMethod"("gatewayConfigId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PaymentMethod_gatewayConfigId_fkey') THEN
    ALTER TABLE "PaymentMethod" ADD CONSTRAINT "PaymentMethod_gatewayConfigId_fkey" FOREIGN KEY ("gatewayConfigId") REFERENCES "PaymentGatewayConfig"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- PaymentWebhookEvent operational columns (idempotency + audit)
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='PaymentWebhookEvent' AND column_name='status') THEN
    ALTER TABLE "PaymentWebhookEvent" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'RECEIVED';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='PaymentWebhookEvent' AND column_name='reference') THEN
    ALTER TABLE "PaymentWebhookEvent" ADD COLUMN "reference" TEXT;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='PaymentWebhookEvent' AND column_name='amount') THEN
    ALTER TABLE "PaymentWebhookEvent" ADD COLUMN "amount" INTEGER;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='PaymentWebhookEvent' AND column_name='currency') THEN
    ALTER TABLE "PaymentWebhookEvent" ADD COLUMN "currency" TEXT;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='PaymentWebhookEvent' AND column_name='payload') THEN
    ALTER TABLE "PaymentWebhookEvent" ADD COLUMN "payload" JSONB;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='PaymentWebhookEvent' AND column_name='signatureValid') THEN
    ALTER TABLE "PaymentWebhookEvent" ADD COLUMN "signatureValid" BOOLEAN NOT NULL DEFAULT true;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "PaymentWebhookEvent_status_idx" ON "PaymentWebhookEvent"("status");
CREATE INDEX IF NOT EXISTS "PaymentWebhookEvent_reference_idx" ON "PaymentWebhookEvent"("reference");
