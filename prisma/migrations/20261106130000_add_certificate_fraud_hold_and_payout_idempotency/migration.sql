ALTER TABLE "certificates"
ADD COLUMN "isFraudHeld" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "payouts"
ADD COLUMN "idempotencyKey" TEXT;

CREATE UNIQUE INDEX "payouts_idempotencyKey_key"
ON "payouts"("idempotencyKey");
