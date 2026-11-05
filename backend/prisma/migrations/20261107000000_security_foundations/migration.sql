CREATE TYPE "KycReviewAction" AS ENUM ('REVIEW', 'CORRECTION');
CREATE TYPE "PartnerIdempotencyStatus" AS ENUM ('PROCESSING', 'COMPLETED', 'FAILED');

ALTER TABLE "kyc_documents"
    ALTER COLUMN "file_data" DROP NOT NULL,
    ADD COLUMN "ciphertext" BYTEA,
    ADD COLUMN "encryption_nonce" BYTEA,
    ADD COLUMN "authentication_tag" BYTEA,
    ADD COLUMN "key_version" VARCHAR(64),
    ADD COLUMN "wrapped_data_key" BYTEA,
    ADD COLUMN "key_wrap_nonce" BYTEA,
    ADD COLUMN "key_wrap_tag" BYTEA,
    ADD COLUMN "encryption_algorithm" VARCHAR(32),
    ADD CONSTRAINT "kyc_documents_encryption_state_check" CHECK (
        (
            "file_data" IS NOT NULL
            AND "ciphertext" IS NULL
            AND "encryption_nonce" IS NULL
            AND "authentication_tag" IS NULL
            AND "key_version" IS NULL
            AND "wrapped_data_key" IS NULL
            AND "key_wrap_nonce" IS NULL
            AND "key_wrap_tag" IS NULL
            AND "encryption_algorithm" IS NULL
        )
        OR
        (
            "file_data" IS NULL
            AND "ciphertext" IS NOT NULL
            AND "encryption_nonce" IS NOT NULL
            AND octet_length("encryption_nonce") = 12
            AND "authentication_tag" IS NOT NULL
            AND octet_length("authentication_tag") = 16
            AND "key_version" IS NOT NULL
            AND "wrapped_data_key" IS NOT NULL
            AND "key_wrap_nonce" IS NOT NULL
            AND octet_length("key_wrap_nonce") = 12
            AND "key_wrap_tag" IS NOT NULL
            AND octet_length("key_wrap_tag") = 16
            AND "encryption_algorithm" = 'AES-256-GCM'
        )
    );

CREATE TABLE "kyc_review_events" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "reviewer_id" VARCHAR(255) NOT NULL,
    "reviewer_issuer" VARCHAR(255) NOT NULL,
    "action" "KycReviewAction" NOT NULL,
    "previous_status" "KycStatus",
    "decision" "KycStatus" NOT NULL,
    "reason" VARCHAR(1000) NOT NULL,
    "correction_of_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "kyc_review_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "kyc_review_events_decision_check" CHECK ("decision" IN ('APPROVED', 'REJECTED')),
    CONSTRAINT "kyc_review_events_reason_check" CHECK (length(trim("reason")) >= 3)
);

CREATE INDEX "kyc_review_events_user_id_created_at_idx"
    ON "kyc_review_events"("user_id", "created_at");
CREATE INDEX "kyc_review_events_reviewer_issuer_reviewer_id_created_at_idx"
    ON "kyc_review_events"("reviewer_issuer", "reviewer_id", "created_at");

ALTER TABLE "kyc_review_events"
    ADD CONSTRAINT "kyc_review_events_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "kyc_review_events_correction_of_id_fkey"
        FOREIGN KEY ("correction_of_id") REFERENCES "kyc_review_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION prevent_kyc_review_event_mutation()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'KYC review events are append-only; corrections must be recorded as new events'
        USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "trg_prevent_kyc_review_event_mutation"
BEFORE UPDATE OR DELETE ON "kyc_review_events"
FOR EACH ROW EXECUTE FUNCTION prevent_kyc_review_event_mutation();

CREATE OR REPLACE FUNCTION require_kyc_review_event_for_final_status()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW."kyc_status" IN ('APPROVED', 'REJECTED')
       AND NEW."kyc_status" IS DISTINCT FROM OLD."kyc_status"
       AND NOT EXISTS (
           SELECT 1
           FROM "kyc_review_events"
           WHERE "user_id" = NEW."id"
             AND "previous_status" IS NOT DISTINCT FROM OLD."kyc_status"
             AND "decision" = NEW."kyc_status"
       ) THEN
        RAISE EXCEPTION 'A final KYC status requires a corresponding review audit event'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "trg_require_kyc_review_event_for_final_status"
AFTER UPDATE ON "users"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION require_kyc_review_event_for_final_status();

CREATE TABLE "partner_idempotency" (
    "id" UUID NOT NULL,
    "partner_id" VARCHAR(64) NOT NULL,
    "idempotency_key" VARCHAR(128) NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "status" "PartnerIdempotencyStatus" NOT NULL DEFAULT 'PROCESSING',
    "response_status" INTEGER,
    "response_body" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "partner_idempotency_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "partner_idempotency_final_response_check" CHECK (
        ("status" = 'PROCESSING' AND "response_status" IS NULL AND "response_body" IS NULL)
        OR
        ("status" IN ('COMPLETED', 'FAILED') AND "response_status" IS NOT NULL AND "response_body" IS NOT NULL)
    )
);

CREATE UNIQUE INDEX "partner_idempotency_partner_id_idempotency_key_key"
    ON "partner_idempotency"("partner_id", "idempotency_key");
CREATE INDEX "partner_idempotency_status_expires_at_idx"
    ON "partner_idempotency"("status", "expires_at");
