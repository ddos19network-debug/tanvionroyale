-- CreateEnum
CREATE TYPE "P2PVerificationStatus" AS ENUM ('UNVERIFIED', 'VERIFIED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "P2POrderSide" AS ENUM ('BUY', 'SELL');

-- CreateEnum
CREATE TYPE "P2POrderStatus" AS ENUM ('CREATED', 'PAYMENT_PENDING', 'PAYMENT_SUBMITTED', 'PAYMENT_VERIFICATION_PENDING', 'PROCESSING', 'COMPLETED', 'CANCELLED', 'EXPIRED', 'DISPUTED', 'REFUNDED', 'FAILED');

-- CreateEnum
CREATE TYPE "P2PPaymentStatus" AS ENUM ('PENDING', 'SUBMITTED', 'VERIFIED', 'REJECTED', 'FAILED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "P2PDisputeStatus" AS ENUM ('OPEN', 'UNDER_REVIEW', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "P2PDisputeResolution" AS ENUM ('BUYER_WINS', 'SELLER_WINS', 'SPLIT');

-- CreateTable
CREATE TABLE "P2PMerchantProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "verificationStatus" "P2PVerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "totalOrders" INTEGER NOT NULL DEFAULT 0,
    "completedOrders" INTEGER NOT NULL DEFAULT 0,
    "cancelledOrders" INTEGER NOT NULL DEFAULT 0,
    "completionRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "positiveFeedback" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "avgCompletionMin" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "P2PMerchantProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "P2POffer" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "merchantProfileId" TEXT,
    "symbol" TEXT NOT NULL,
    "fiat" TEXT NOT NULL,
    "side" "P2POrderSide" NOT NULL,
    "pricePerFiatUnit" INTEGER NOT NULL,
    "cryptoScale" INTEGER NOT NULL DEFAULT 8,
    "availableCrypto" BIGINT NOT NULL,
    "minOrderFiat" INTEGER NOT NULL,
    "maxOrderFiat" INTEGER NOT NULL,
    "paymentMethods" JSONB NOT NULL DEFAULT '[]',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "P2POffer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "P2PMerchantProfile_userId_key" ON "P2PMerchantProfile"("userId");

-- CreateIndex
CREATE INDEX "P2PMerchantProfile_verificationStatus_isActive_idx" ON "P2PMerchantProfile"("verificationStatus", "isActive");

-- CreateIndex
CREATE INDEX "P2POffer_symbol_fiat_side_isActive_idx" ON "P2POffer"("symbol", "fiat", "side", "isActive");

-- CreateIndex
CREATE INDEX "P2POffer_merchantId_isActive_idx" ON "P2POffer"("merchantId", "isActive");

-- CreateIndex
CREATE INDEX "P2POffer_pricePerFiatUnit_idx" ON "P2POffer"("pricePerFiatUnit");

-- CreateIndex
CREATE INDEX "P2POffer_availableCrypto_idx" ON "P2POffer"("availableCrypto");

-- AddForeignKey
ALTER TABLE "P2PMerchantProfile" ADD CONSTRAINT "P2PMerchantProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "P2POffer" ADD CONSTRAINT "P2POffer_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "P2POffer" ADD CONSTRAINT "P2POffer_merchantProfileId_fkey" FOREIGN KEY ("merchantProfileId") REFERENCES "P2PMerchantProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "P2POrder" (
    "id" TEXT NOT NULL,
    "orderReference" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "fiat" TEXT NOT NULL,
    "side" "P2POrderSide" NOT NULL,
    "pricePerFiatUnit" INTEGER NOT NULL,
    "cryptoAmount" BIGINT NOT NULL,
    "fiatAmount" INTEGER NOT NULL,
    "feeAmount" INTEGER NOT NULL DEFAULT 0,
    "status" "P2POrderStatus" NOT NULL DEFAULT 'CREATED',
    "paymentMethod" TEXT,
    "paymentReference" TEXT,
    "paymentProofUrl" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancellationReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "P2POrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "P2PPayment" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "payerId" TEXT NOT NULL,
    "payeeId" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "reference" TEXT,
    "proofUrl" TEXT,
    "status" "P2PPaymentStatus" NOT NULL DEFAULT 'PENDING',
    "verifiedBy" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "verificationNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "P2PPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "P2PDispute" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "openedBy" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "P2PDisputeStatus" NOT NULL DEFAULT 'OPEN',
    "resolution" "P2PDisputeResolution",
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolutionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "P2PDispute_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "P2POrder_orderReference_key" ON "P2POrder"("orderReference");

-- CreateIndex
CREATE UNIQUE INDEX "P2POrder_idempotencyKey_key" ON "P2POrder"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "P2POrder_offerId_key" ON "P2POrder"("offerId");

-- CreateIndex
CREATE INDEX "P2POrder_buyerId_status_idx" ON "P2POrder"("buyerId", "status");

-- CreateIndex
CREATE INDEX "P2POrder_sellerId_status_idx" ON "P2POrder"("sellerId", "status");

-- CreateIndex
CREATE INDEX "P2POrder_status_createdAt_idx" ON "P2POrder"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "P2PPayment_orderId_key" ON "P2PPayment"("orderId");

-- CreateIndex
CREATE INDEX "P2PPayment_payerId_status_idx" ON "P2PPayment"("payerId", "status");

-- CreateIndex
CREATE INDEX "P2PPayment_status_idx" ON "P2PPayment"("status");

-- CreateIndex
CREATE UNIQUE INDEX "P2PDispute_orderId_key" ON "P2PDispute"("orderId");

-- CreateIndex
CREATE INDEX "P2PDispute_status_idx" ON "P2PDispute"("status");

-- AddForeignKey
ALTER TABLE "P2POrder" ADD CONSTRAINT "P2POrder_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "P2POrder" ADD CONSTRAINT "P2POrder_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "P2POrder" ADD CONSTRAINT "P2POrder_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "P2POffer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "P2PPayment" ADD CONSTRAINT "P2PPayment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "P2POrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "P2PDispute" ADD CONSTRAINT "P2PDispute_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "P2POrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;