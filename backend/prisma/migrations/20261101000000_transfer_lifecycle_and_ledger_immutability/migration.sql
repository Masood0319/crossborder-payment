BEGIN;

CREATE TYPE "TransferStatus" AS ENUM (
    'INITIATED',
    'VALIDATING',
    'QUOTED',
    'FUNDS_DEBITED',
    'SUBMITTED',
    'ACCEPTED',
    'SETTLED',
    'FAILED',
    'REJECTED',
    'RETURNED',
    'CANCELLED',
    'SIMULATED',
    'REVERSED'
);

CREATE TYPE "KycStatus" AS ENUM ('NOT_SUBMITTED', 'PENDING', 'APPROVED', 'REJECTED');
CREATE TYPE "BeneficiaryVerificationStatus" AS ENUM ('UNVERIFIED', 'FORMAT_VALIDATED', 'VERIFIED');

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM "users"
        WHERE UPPER("kyc_status") NOT IN ('NOT_SUBMITTED', 'PENDING', 'APPROVED', 'REJECTED')
    ) THEN
        RAISE EXCEPTION 'Cannot migrate users: an unknown KYC status value exists';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM "transfers"
        WHERE UPPER("status") NOT IN (
            'COMPLETED', 'PENDING', 'PROCESSING', 'INITIATED', 'VALIDATING',
            'QUOTED', 'FUNDS_RESERVED', 'FUNDS_DEBITED', 'SUBMITTED', 'ACCEPTED', 'SETTLED',
            'FAILED', 'REJECTED', 'RETURNED', 'CANCELLED', 'SIMULATED', 'REVERSED'
        )
    ) THEN
        RAISE EXCEPTION 'Cannot migrate transfers: an unknown status value exists';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM "entries"
        GROUP BY "transaction_id", "sequence_order"
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION 'Cannot add ledger entry sequence uniqueness: duplicate sequence orders exist';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM "nostro_vostro_balances"
        WHERE "current_balance" < 0
           OR "reserved_balance" < 0
           OR "reserved_balance" > "current_balance"
           OR "available_balance" <> "current_balance" - "reserved_balance"
           OR "minimum_threshold" < 0
           OR "maximum_threshold" <= "minimum_threshold"
           OR "target_balance" < "minimum_threshold"
           OR "target_balance" > "maximum_threshold"
    ) THEN
        RAISE EXCEPTION 'Cannot add liquidity integrity constraints: invalid nostro balance or threshold data exists';
    END IF;
END;
$$;

ALTER TABLE "users" ALTER COLUMN "kyc_status" DROP DEFAULT;
ALTER TABLE "users"
    ALTER COLUMN "kyc_status" TYPE "KycStatus"
    USING UPPER("kyc_status")::"KycStatus";
ALTER TABLE "users" ALTER COLUMN "kyc_status" SET DEFAULT 'NOT_SUBMITTED';

ALTER TABLE "beneficiaries"
    ADD COLUMN "verification_status" "BeneficiaryVerificationStatus" NOT NULL DEFAULT 'UNVERIFIED';

UPDATE "fx_quotes"
SET "consumed_at" = "createdAt"
WHERE "state" = 'CONSUMED' AND "consumed_at" IS NULL;
ALTER TABLE "fx_quotes"
    ADD CONSTRAINT "fx_quotes_consumed_timestamp_check"
    CHECK (("state" = 'CONSUMED' AND "consumed_at" IS NOT NULL)
        OR ("state" <> 'CONSUMED' AND "consumed_at" IS NULL));

ALTER TABLE "nostro_vostro_balances"
    ADD CONSTRAINT "nostro_balance_nonnegative_check"
        CHECK ("current_balance" >= 0 AND "reserved_balance" >= 0 AND "available_balance" >= 0),
    ADD CONSTRAINT "nostro_reserved_within_balance_check"
        CHECK ("reserved_balance" <= "current_balance"),
    ADD CONSTRAINT "nostro_available_consistency_check"
        CHECK ("available_balance" = "current_balance" - "reserved_balance"),
    ADD CONSTRAINT "nostro_threshold_order_check"
        CHECK ("minimum_threshold" >= 0 AND "maximum_threshold" > "minimum_threshold"),
    ADD CONSTRAINT "nostro_target_within_thresholds_check"
        CHECK ("target_balance" >= "minimum_threshold" AND "target_balance" <= "maximum_threshold");

ALTER TABLE "transfers" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "transfers"
    ALTER COLUMN "status" TYPE "TransferStatus"
    USING (
        CASE UPPER("status")
            WHEN 'COMPLETED' THEN 'SIMULATED'
            WHEN 'SETTLED' THEN 'SIMULATED'
            WHEN 'PENDING' THEN 'INITIATED'
            WHEN 'PROCESSING' THEN 'SUBMITTED'
            WHEN 'FUNDS_RESERVED' THEN 'FUNDS_DEBITED'
            ELSE UPPER("status")
        END
    )::"TransferStatus";
ALTER TABLE "transfers" ALTER COLUMN "status" SET DEFAULT 'INITIATED';

UPDATE "transfers"
SET "timeline" = COALESCE((
    SELECT jsonb_agg(
        CASE
            WHEN event->>'step' = 'DEPOSIT_CAPTURED'
                THEN jsonb_set(jsonb_set(event, '{step}', '"WALLET_DEBITED"'::jsonb), '{label}', '"Wallet debit posted"'::jsonb)
            WHEN event->>'step' = 'PAYOUT_DISPATCHED'
                THEN jsonb_set(jsonb_set(event, '{step}', '"INSTRUCTION_CREATED"'::jsonb), '{label}', '"Payment instruction prepared"'::jsonb)
            WHEN event->>'step' = 'FUNDS_RECEIVED'
                THEN jsonb_set(jsonb_set(event, '{status}', '"PENDING"'::jsonb), '{label}', '"External settlement"'::jsonb)
            ELSE event
        END
        ORDER BY ordinal
    )::json
    FROM jsonb_array_elements("timeline"::jsonb) WITH ORDINALITY AS timeline_events(event, ordinal)
) , "timeline"::json)
WHERE jsonb_typeof("timeline"::jsonb) = 'array';

ALTER TABLE "transactions"
    ADD COLUMN "reversal_of_id" UUID,
    ADD COLUMN "reversal_reason" VARCHAR(255),
    ADD COLUMN "reversed_at" TIMESTAMP(3);

CREATE UNIQUE INDEX "transactions_reversal_of_id_key" ON "transactions"("reversal_of_id");
ALTER TABLE "transactions"
    ADD CONSTRAINT "transactions_reversal_of_id_fkey"
    FOREIGN KEY ("reversal_of_id") REFERENCES "transactions"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "entries" DROP CONSTRAINT "entries_transaction_id_fkey";
ALTER TABLE "entries"
    ADD CONSTRAINT "entries_transaction_id_fkey"
    FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "entries_transaction_id_sequence_order_key"
    ON "entries"("transaction_id", "sequence_order");

CREATE TABLE "transfer_status_events" (
    "id" UUID NOT NULL,
    "transfer_id" UUID NOT NULL,
    "sequence_order" INTEGER NOT NULL,
    "from_status" "TransferStatus",
    "to_status" "TransferStatus" NOT NULL,
    "reason" VARCHAR(255) NOT NULL,
    "actor_type" VARCHAR(32) NOT NULL DEFAULT 'SYSTEM',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "transfer_status_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "transfer_status_events_transfer_id_created_at_idx"
    ON "transfer_status_events"("transfer_id", "created_at");
CREATE UNIQUE INDEX "transfer_status_events_transfer_id_sequence_order_key"
    ON "transfer_status_events"("transfer_id", "sequence_order");
ALTER TABLE "transfer_status_events"
    ADD CONSTRAINT "transfer_status_events_transfer_id_fkey"
    FOREIGN KEY ("transfer_id") REFERENCES "transfers"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "transfer_status_events" (
    "id", "transfer_id", "sequence_order", "from_status", "to_status", "reason", "actor_type", "created_at"
)
SELECT
    gen_random_uuid(),
    "id",
    1,
    NULL,
    "status",
    'Legacy status migrated; bank submission and settlement are not verified',
    'MIGRATION',
    "created_at"
FROM "transfers";

CREATE OR REPLACE FUNCTION prevent_posted_transaction_delete()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD."postedAt" IS NOT NULL
       OR OLD."status" IN ('POSTED', 'REVERSED')
       OR EXISTS (SELECT 1 FROM "entries" WHERE "transaction_id" = OLD."id") THEN
        RAISE EXCEPTION 'Posted financial transactions cannot be deleted; use a compensating reversal'
            USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "trg_prevent_posted_transaction_delete"
BEFORE DELETE ON "transactions"
FOR EACH ROW EXECUTE FUNCTION prevent_posted_transaction_delete();

CREATE OR REPLACE FUNCTION prevent_ledger_entry_mutation()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Ledger entries are immutable; use a compensating reversal'
        USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "trg_prevent_ledger_entry_mutation"
BEFORE UPDATE OR DELETE ON "entries"
FOR EACH ROW EXECUTE FUNCTION prevent_ledger_entry_mutation();

CREATE OR REPLACE FUNCTION prevent_transfer_status_event_mutation()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Transfer status events are append-only'
        USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "trg_prevent_transfer_status_event_mutation"
BEFORE UPDATE OR DELETE ON "transfer_status_events"
FOR EACH ROW EXECUTE FUNCTION prevent_transfer_status_event_mutation();

COMMIT;
