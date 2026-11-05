CREATE TYPE "CallbackSource" AS ENUM ('SIMULATED', 'EXTERNAL_UNVERIFIED');
CREATE TYPE "CallbackProcessingStatus" AS ENUM ('RECEIVED', 'FAILED', 'IGNORED_SIMULATED');
CREATE TYPE "ReconciliationStatus" AS ENUM (
    'UNRECONCILED',
    'MATCHED',
    'MISMATCHED',
    'MISSING_EXTERNAL',
    'MISSING_INTERNAL'
);

CREATE TABLE "callback_inbox" (
    "id" UUID NOT NULL,
    "source" "CallbackSource" NOT NULL,
    "message_id" VARCHAR(64) NOT NULL,
    "original_uetr" UUID NOT NULL,
    "transaction_status" "IsoMessageStatus" NOT NULL,
    "callback_timestamp" TIMESTAMP(3) NOT NULL,
    "payload_hash" CHAR(64) NOT NULL,
    "payload" JSONB NOT NULL,
    "processing_status" "CallbackProcessingStatus" NOT NULL DEFAULT 'RECEIVED',
    "processing_error" VARCHAR(255),
    "transaction_id" UUID,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),

    CONSTRAINT "callback_inbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "callback_inbox_source_message_id_key"
    ON "callback_inbox"("source", "message_id");
CREATE INDEX "callback_inbox_original_uetr_received_at_idx"
    ON "callback_inbox"("original_uetr", "received_at");
CREATE INDEX "callback_inbox_processing_status_received_at_idx"
    ON "callback_inbox"("processing_status", "received_at");

ALTER TABLE "callback_inbox"
    ADD CONSTRAINT "callback_inbox_transaction_id_fkey"
    FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "reconciliation_records" (
    "id" UUID NOT NULL,
    "source" VARCHAR(64) NOT NULL,
    "external_reference" VARCHAR(128) NOT NULL,
    "external_uetr" UUID,
    "transaction_id" UUID,
    "statement_date" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "external_status" VARCHAR(32) NOT NULL,
    "status" "ReconciliationStatus" NOT NULL DEFAULT 'UNRECONCILED',
    "details" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reconciliation_records_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "reconciliation_records_source_external_reference_key"
    ON "reconciliation_records"("source", "external_reference");
CREATE INDEX "reconciliation_records_transaction_id_idx"
    ON "reconciliation_records"("transaction_id");
CREATE INDEX "reconciliation_records_status_statement_date_idx"
    ON "reconciliation_records"("status", "statement_date");

ALTER TABLE "reconciliation_records"
    ADD CONSTRAINT "reconciliation_records_transaction_id_fkey"
    FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
