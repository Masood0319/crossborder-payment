-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE');

-- CreateEnum
CREATE TYPE "EntryDirection" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('PENDING', 'POSTED', 'REJECTED', 'REVERSED');

-- CreateEnum
CREATE TYPE "PaymentRail" AS ENUM ('RAAST_PK', 'AANI_UAE', 'SARIE_KSA');

-- CreateEnum
CREATE TYPE "IsoMessageStatus" AS ENUM ('ACCP', 'RJCT', 'PDNG');

-- CreateTable
CREATE TABLE "accounts" (
    "id" UUID NOT NULL,
    "accountNumber" VARCHAR(64) NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "type" "AccountType" NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "bankIdentifier" VARCHAR(11),
    "iban" VARCHAR(34),
    "currentBalance" DECIMAL(18,4) NOT NULL DEFAULT 0.0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" UUID NOT NULL,
    "reference" VARCHAR(64) NOT NULL,
    "uetr" UUID,
    "type" VARCHAR(32) NOT NULL,
    "corridorCode" VARCHAR(16) NOT NULL,
    "status" "TransactionStatus" NOT NULL DEFAULT 'PENDING',
    "totalDebitBase" DECIMAL(18,4) NOT NULL,
    "totalCreditBase" DECIMAL(18,4) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'USD',
    "description" VARCHAR(255),
    "postedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entries" (
    "id" UUID NOT NULL,
    "transaction_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "direction" "EntryDirection" NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "exchange_rate" DECIMAL(14,6) NOT NULL DEFAULT 1.0,
    "base_amount" DECIMAL(18,4) NOT NULL,
    "sequence_order" INTEGER NOT NULL,
    "description" VARCHAR(255),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nostro_vostro_balances" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "bank_code" VARCHAR(11) NOT NULL,
    "bank_name" VARCHAR(128) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "current_balance" DECIMAL(18,4) NOT NULL,
    "reserved_balance" DECIMAL(18,4) NOT NULL DEFAULT 0.0,
    "available_balance" DECIMAL(18,4) NOT NULL,
    "minimum_threshold" DECIMAL(18,4) NOT NULL,
    "maximum_threshold" DECIMAL(18,4) NOT NULL,
    "target_balance" DECIMAL(18,4) NOT NULL,
    "last_reconciled_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "nostro_vostro_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "corridors" (
    "id" UUID NOT NULL,
    "code" VARCHAR(16) NOT NULL,
    "sourceCurrency" VARCHAR(3) NOT NULL,
    "targetCurrency" VARCHAR(3) NOT NULL,
    "sourceRail" "PaymentRail" NOT NULL,
    "destinationRail" "PaymentRail" NOT NULL,
    "baseSpreadBps" INTEGER NOT NULL DEFAULT 30,
    "volatilityBufferBps" INTEGER NOT NULL DEFAULT 10,
    "quoteTtlSeconds" INTEGER NOT NULL DEFAULT 60,
    "minTransferAmount" DECIMAL(18,4) NOT NULL,
    "maxTransferAmount" DECIMAL(18,4) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "corridors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fx_quotes" (
    "id" UUID NOT NULL,
    "quoteId" UUID NOT NULL,
    "corridorCode" VARCHAR(16) NOT NULL,
    "sourceCurrency" VARCHAR(3) NOT NULL,
    "targetCurrency" VARCHAR(3) NOT NULL,
    "instructedAmount" DECIMAL(18,4) NOT NULL,
    "settlementAmount" DECIMAL(18,4) NOT NULL,
    "midMarketRate" DECIMAL(14,6) NOT NULL,
    "clientRate" DECIMAL(14,6) NOT NULL,
    "spreadBps" INTEGER NOT NULL,
    "volatilityBufferBps" INTEGER NOT NULL,
    "spreadRevenue" DECIMAL(18,4) NOT NULL,
    "isConsumed" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fx_quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "iso_message_audits" (
    "id" UUID NOT NULL,
    "messageId" VARCHAR(64) NOT NULL,
    "uetr" UUID NOT NULL,
    "messageType" VARCHAR(32) NOT NULL,
    "status" "IsoMessageStatus" NOT NULL,
    "rawXmlPayload" TEXT NOT NULL,
    "transactionId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "iso_message_audits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "full_name" VARCHAR(128) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "phone" VARCHAR(32) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "pin_hash" VARCHAR(255) NOT NULL,
    "kyc_status" VARCHAR(32) NOT NULL DEFAULT 'NOT_SUBMITTED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallets" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "balance" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "shadow_account_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "beneficiaries" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "full_name" VARCHAR(128) NOT NULL,
    "iban" VARCHAR(34) NOT NULL,
    "bic" VARCHAR(11) NOT NULL,
    "bank_name" VARCHAR(128) NOT NULL,
    "country" VARCHAR(2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "beneficiaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kyc_documents" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "document_type" VARCHAR(32) NOT NULL,
    "file_name" VARCHAR(255) NOT NULL,
    "mime_type" VARCHAR(128) NOT NULL,
    "file_data" BYTEA NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kyc_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_activities" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "wallet_id" UUID NOT NULL,
    "transaction_id" UUID,
    "kind" VARCHAR(32) NOT NULL,
    "status" VARCHAR(32) NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "reference" VARCHAR(64) NOT NULL,
    "description" VARCHAR(255) NOT NULL,
    "details" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transfers" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "wallet_id" UUID NOT NULL,
    "beneficiary_id" UUID NOT NULL,
    "transaction_id" UUID NOT NULL,
    "uetr" UUID NOT NULL,
    "corridor_code" VARCHAR(16) NOT NULL,
    "send_amount" DECIMAL(18,4) NOT NULL,
    "fee_amount" DECIMAL(18,4) NOT NULL,
    "source_currency" VARCHAR(3) NOT NULL,
    "payout_amount" DECIMAL(18,4) NOT NULL,
    "payout_currency" VARCHAR(3) NOT NULL,
    "exchange_rate" DECIMAL(14,6) NOT NULL,
    "status" VARCHAR(32) NOT NULL DEFAULT 'COMPLETED',
    "purpose" VARCHAR(64) NOT NULL,
    "pacs008_xml" TEXT NOT NULL,
    "pacs002_xml" TEXT NOT NULL,
    "timeline" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transfers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "accounts_accountNumber_key" ON "accounts"("accountNumber");

-- CreateIndex
CREATE INDEX "accounts_currency_idx" ON "accounts"("currency");

-- CreateIndex
CREATE INDEX "accounts_bankIdentifier_idx" ON "accounts"("bankIdentifier");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_reference_key" ON "transactions"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_uetr_key" ON "transactions"("uetr");

-- CreateIndex
CREATE INDEX "transactions_uetr_idx" ON "transactions"("uetr");

-- CreateIndex
CREATE INDEX "transactions_corridorCode_idx" ON "transactions"("corridorCode");

-- CreateIndex
CREATE INDEX "transactions_status_idx" ON "transactions"("status");

-- CreateIndex
CREATE INDEX "entries_transaction_id_idx" ON "entries"("transaction_id");

-- CreateIndex
CREATE INDEX "entries_account_id_idx" ON "entries"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "nostro_vostro_balances_bank_code_currency_key" ON "nostro_vostro_balances"("bank_code", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "corridors_code_key" ON "corridors"("code");

-- CreateIndex
CREATE UNIQUE INDEX "fx_quotes_quoteId_key" ON "fx_quotes"("quoteId");

-- CreateIndex
CREATE INDEX "fx_quotes_quoteId_idx" ON "fx_quotes"("quoteId");

-- CreateIndex
CREATE INDEX "fx_quotes_expiresAt_idx" ON "fx_quotes"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "iso_message_audits_messageId_key" ON "iso_message_audits"("messageId");

-- CreateIndex
CREATE INDEX "iso_message_audits_uetr_idx" ON "iso_message_audits"("uetr");

-- CreateIndex
CREATE INDEX "iso_message_audits_messageType_idx" ON "iso_message_audits"("messageType");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "wallets_shadow_account_id_key" ON "wallets"("shadow_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "wallets_user_id_currency_key" ON "wallets"("user_id", "currency");

-- CreateIndex
CREATE INDEX "beneficiaries_user_id_idx" ON "beneficiaries"("user_id");

-- CreateIndex
CREATE INDEX "kyc_documents_user_id_idx" ON "kyc_documents"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_activities_reference_key" ON "wallet_activities"("reference");

-- CreateIndex
CREATE INDEX "wallet_activities_user_id_created_at_idx" ON "wallet_activities"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "wallet_activities_wallet_id_created_at_idx" ON "wallet_activities"("wallet_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "transfers_transaction_id_key" ON "transfers"("transaction_id");

-- CreateIndex
CREATE UNIQUE INDEX "transfers_uetr_key" ON "transfers"("uetr");

-- CreateIndex
CREATE INDEX "transfers_user_id_created_at_idx" ON "transfers"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "entries" ADD CONSTRAINT "entries_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entries" ADD CONSTRAINT "entries_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nostro_vostro_balances" ADD CONSTRAINT "nostro_vostro_balances_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fx_quotes" ADD CONSTRAINT "fx_quotes_corridorCode_fkey" FOREIGN KEY ("corridorCode") REFERENCES "corridors"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "iso_message_audits" ADD CONSTRAINT "iso_message_audits_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_shadow_account_id_fkey" FOREIGN KEY ("shadow_account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "beneficiaries" ADD CONSTRAINT "beneficiaries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kyc_documents" ADD CONSTRAINT "kyc_documents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_activities" ADD CONSTRAINT "wallet_activities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_activities" ADD CONSTRAINT "wallet_activities_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_activities" ADD CONSTRAINT "wallet_activities_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_beneficiary_id_fkey" FOREIGN KEY ("beneficiary_id") REFERENCES "beneficiaries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

