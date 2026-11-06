-- CreateTable
CREATE TABLE "FreePlaySlotRound" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "gameSlug" TEXT NOT NULL,
    "clientRequestId" TEXT NOT NULL,
    "stake" INTEGER NOT NULL,
    "totalPayBp" INTEGER NOT NULL,
    "payout" INTEGER NOT NULL,
    "capped" BOOLEAN NOT NULL DEFAULT false,
    "outcome" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FreePlaySlotRound_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FreePlaySlotRound_userId_clientRequestId_key" ON "FreePlaySlotRound"("userId", "clientRequestId");

-- CreateIndex
CREATE INDEX "FreePlaySlotRound_userId_gameSlug_createdAt_idx" ON "FreePlaySlotRound"("userId", "gameSlug", "createdAt");

-- AddForeignKey
ALTER TABLE "FreePlaySlotRound" ADD CONSTRAINT "FreePlaySlotRound_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
