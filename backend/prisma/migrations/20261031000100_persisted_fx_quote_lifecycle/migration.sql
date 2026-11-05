CREATE TYPE "FxQuoteState" AS ENUM ('ACTIVE', 'CONSUMED', 'EXPIRED', 'CANCELLED');

ALTER TABLE "fx_quotes"
    ADD COLUMN "user_id" UUID,
    ADD COLUMN "idempotency_key" VARCHAR(64),
    ADD COLUMN "rate_provider" VARCHAR(64) NOT NULL DEFAULT 'LEGACY_UNKNOWN',
    ADD COLUMN "rate_observed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN "state" "FxQuoteState" NOT NULL DEFAULT 'ACTIVE',
    ADD COLUMN "consumed_at" TIMESTAMP(3),
    ADD COLUMN "transfer_id" UUID;

UPDATE "fx_quotes"
SET
    "state" = CASE WHEN "isConsumed" THEN 'CONSUMED'::"FxQuoteState" ELSE 'ACTIVE'::"FxQuoteState" END,
    "rate_observed_at" = "createdAt";

ALTER TABLE "fx_quotes"
    DROP COLUMN "isConsumed";

CREATE UNIQUE INDEX "fx_quotes_transfer_id_key" ON "fx_quotes"("transfer_id");
CREATE UNIQUE INDEX "fx_quotes_user_id_idempotency_key_key" ON "fx_quotes"("user_id", "idempotency_key");
CREATE INDEX "fx_quotes_user_id_state_expires_at_idx" ON "fx_quotes"("user_id", "state", "expiresAt");

ALTER TABLE "fx_quotes"
    ADD CONSTRAINT "fx_quotes_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT "fx_quotes_transfer_id_fkey"
        FOREIGN KEY ("transfer_id") REFERENCES "transfers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
