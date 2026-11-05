# Cross-Border Payment Orchestration

The repository contains two independently configurable applications:

- `backend/` — Express API and payment orchestration modules, ISO 20022 processing, sanctions screening, treasury, ledger, and Prisma schema.
- `frontend-app/` — Next.js public landing page and consumer e-wallet app for registration, KYC submission, wallet top-ups, and PKR transfers to UAE/Saudi Arabia. It also includes a staff-only treasury liquidity dashboard.

The public site is served at `/`; consumer registration and sign-in are at `/register` and `/login`. Consumer wallet pages remain protected by consumer authentication. The treasury dashboard is at `/treasury` and requires an authorized staff session from the externally configured identity provider; this repository does not implement staff sign-in or provisioning.

## Requirements

- Node.js 20 or later
- npm
- PostgreSQL for Prisma database operations
- Redis only if a Redis-backed queue is enabled

## Install

From this repository directory:

```powershell
npm.cmd install
```

Copy the environment examples and set values for your local environment:

```powershell
Copy-Item backend\.env.example backend\.env
Copy-Item frontend-app\.env.local.example frontend-app\.env.local
```

Set strong, distinct `JWT_SECRET`, `HMAC_SECRET`, `BANK_CALLBACK_HMAC_SECRET`, and `LEDGER_ADMIN_KEY` values in `backend/.env` before starting the backend. Configure the KYC encryption keys and staff identity-provider settings described below before enabling KYC submissions or staff review. The backend defaults to port `5000` and permits the consumer app at `http://localhost:3001`. Set `CONSUMER_FRONTEND_ORIGIN` to change that origin. Set `NEXT_PUBLIC_BACKEND_URL` in the consumer app environment file when the API uses another URL.

The partner payment-initiation endpoint requires `X-Client-Id`, `X-Idempotency-Key`, a current ISO timestamp in `X-Timestamp`, and an HMAC-SHA256 hex signature in `X-Signature`. The signature covers the JSON serialization of `{ "clientId": "...", "timestamp": "...", "idempotencyKey": "...", "body": <request JSON> }`. Idempotency records are stored in PostgreSQL and retained for 90 days; run `npm.cmd run security:purge-partner-idempotency --workspace backend` periodically to remove expired final records. The external callback endpoint uses `BANK_CALLBACK_HMAC_SECRET`; the separately named simulated callback endpoint uses `HMAC_SECRET`. Both require a timestamped signature over `{ "timestamp": "...", "body": <callback JSON> }`. Authenticated callbacks are durably recorded and deduplicated, but receipt does not update a transfer or prove settlement. Consumer JWTs are HS256 tokens issued for the `consumer-app` audience.

### KYC document encryption and reviewer identity

KYC document uploads require application-layer AES-256-GCM envelope encryption. Each file gets a random data-encryption key; the KEK wraps that key and is supplied externally, never stored in PostgreSQL. Configure `KYC_KEK_KEYS_JSON` as a JSON object mapping version identifiers to base64-encoded 32-byte keys, and set `KYC_KEK_ACTIVE_VERSION` to one of those versions. For local-only development, generate a key with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"` and keep it outside source control. The local environment-variable provider is not a cloud KMS and is not production-grade key management. Production deployment requires a separately managed secret/KMS provider and operational key backup/access controls.

Staff authentication is delegated to an external identity provider. Configure `STAFF_JWT_PUBLIC_KEY` (PEM; newlines may be represented as `\\n`), `STAFF_JWT_ISSUER`, and `STAFF_JWT_AUDIENCE`. The IdP must issue RS256 JWTs with a `sub` identifying the individual and a `roles` array containing `KYC_REVIEWER` and/or `KYC_ADMIN`. Reviewers can approve/reject pending KYC; administrators can make traceable corrections and view review history. Both roles can access documents. This repository does not implement staff login, staff provisioning, or an IdP. Do not issue shared staff credentials.

Migration of existing documents is deliberately explicit: the database migration preserves old bytes as plaintext `file_data`, while the document endpoint rejects access to those records until they are encrypted. Before migration, take and verify a protected database backup and configure the KEK variables. Then set `CONFIRM_KYC_LEGACY_ENCRYPTION=YES` and run `npm.cmd run security:encrypt-legacy-kyc --workspace backend`. The script encrypts batches transactionally and clears each legacy plaintext value only after encryption; validate the migration and retain the protected backup according to your data-retention policy.

For KEK rotation, add the new version and key to `KYC_KEK_KEYS_JSON`, set it as `KYC_KEK_ACTIVE_VERSION`, then run `npm.cmd run security:rotate-kyc-keys --workspace backend`. Verify no rows use old versions before removing old keys. Rotation rewraps data keys without changing document ciphertext. Keep old keys available until verification and backup-retention requirements are satisfied.

## Start the applications

Run each service in its own terminal from this repository directory:

```powershell
npm.cmd run start:backend
npm.cmd run start:consumer
```

Alternatively, run each application from its own folder:

```powershell
cd backend
npm.cmd start
```

```powershell
cd frontend-app
npm.cmd run dev
```

The backend health endpoint is `http://localhost:5000/health`.
The consumer wallet app and public site are available at `http://localhost:3001`. It requires KYC approval to send. Authenticated `KYC_REVIEWER` or `KYC_ADMIN` staff can list pending applicants with `GET /api/v1/admin/kyc`, retrieve an encrypted submitted file through `GET /api/v1/admin/kyc/:userId/documents/:documentId`, and approve or reject an application with `POST /api/v1/admin/kyc/:userId/review`. Review decisions require a reason and are recorded as append-only attributed events. `KYC_ADMIN` can record a linked correction rather than changing a prior review. Top-ups and payouts are simulated in this prototype and do not move real funds.

Staff with `TREASURY_VIEWER`, `TREASURY_OPERATOR`, or `TREASURY_ADMIN` can view `GET /api/treasury/liquidity/alerts` and the `/treasury` dashboard. Acknowledging an alert requires `TREASURY_OPERATOR` or `TREASURY_ADMIN` and records an audit event only. Liquidity suggestions do not execute rebalance actions.
The consumer wallet app is available at `http://localhost:3001`. It requires KYC approval to send. Authenticated `KYC_REVIEWER` or `KYC_ADMIN` staff can list pending applicants with `GET /api/v1/admin/kyc`, retrieve an encrypted submitted file through `GET /api/v1/admin/kyc/:userId/documents/:documentId`, and approve or reject an application with `POST /api/v1/admin/kyc/:userId/review`. Staff requests use `Authorization: Bearer <staff JWT>`; review decisions require a reason and are recorded as append-only attributed events. `KYC_ADMIN` can record a linked correction rather than changing a prior review. Top-ups and payouts are simulated in this prototype and do not move real funds.

## Ledger accounting model

Ledger entries retain their original currency and amount, while each entry is valued in USD for reporting at the configured USD-per-currency rate. Cross-currency journals route the difference through an explicit USD FX position-clearing account; disclosed fees, FX spread revenue, and residual valuation gains or losses are recorded separately. Journal debits and credits must balance exactly at the ledger's four-decimal USD reporting precision. Wallet balances and shadow-account postings are updated within the same database transaction. These records model simulated activity only and are not evidence of bank settlement.

FX quotes are persisted per customer with their rate observation time, provider label, expiry, state, and eventual transfer association. A quote can be consumed only once, and consumption commits atomically with the wallet transfer. The current rate feed is static demo data; stale or malformed observations are rejected rather than represented as live market pricing. Restarting the backend does not reset persisted quote state.

Quote freshness, bid/ask spread, market-reference deviation, and client-pricing deviation have separate `FX_MAX_*` configuration limits. Reference rates are static demo baselines, not independent market validation. ISO 20022 serialization writes the destination settlement amount/currency in `IntrBkSttlmAmt`; parsed amounts remain Prisma Decimal values to avoid binary floating-point conversion.

Treasury liquidity alerts validate nonnegative balances, reserved amounts, thresholds, targets, currency precision, and configured counterparty codes using decimal arithmetic. Rebalance amounts are recommendations only; the prototype does not execute liquidity injections or sweeps.

Transfers use controlled lifecycle statuses and append-only status events. The consumer demo ends at `SIMULATED`; it does not report bank acceptance or settlement. Legacy `COMPLETED` and `SETTLED` transfer rows are migrated to `SIMULATED`. Posted ledger entries and status events cannot be updated or deleted in PostgreSQL; corrections require compensating financial records. The reviewer-only `POST /api/v1/admin/transactions/:transactionId/reverse` endpoint accepts a required reason and creates a wallet-balanced compensating journal for eligible wallet activity; it only reverses simulated transfers and requires `LEDGER_ADMIN_KEY`. KYC states are constrained, and beneficiary bank details are marked `FORMAT_VALIDATED` only after IBAN/BIC format checks; ownership is not confirmed.

Security boundaries that remain prototype-only: the local KYC KEK provider reads environment variables and is not a cloud KMS; staff JWT verification depends on an externally provisioned IdP and configured public key; consumer authentication and PIN throttles are in-memory and do not coordinate across backend instances; sanctions data is a bundled demo watchlist, not a live compliance provider; and beneficiary checks validate bank-detail formats, not account ownership. The HS256 consumer JWT setup, HMAC partner API, and local throttles are not substitutes for production identity, managed key lifecycle, persistent/distributed abuse controls, or independent security review. Do not use this deployment to process real money or sensitive production identity documents.

## Build and test

```powershell
npm.cmd run build:backend
npm.cmd run build:consumer
npm.cmd test
```

`npm.cmd test` at the repository root invokes the test scripts provided by the workspaces in PowerShell (use `npm test` in shells that allow the npm script shim).

Run database integration tests only against a dedicated, disposable PostgreSQL test database. Set `TEST_DATABASE_URL` and run `npm.cmd run test:postgres --workspace backend`; the script refuses non-local hosts and database names that do not explicitly identify as test-only.

The Phase 8 security integration suite also requires an isolated local PostgreSQL test database with all migrations applied. Set `TEST_DATABASE_URL` to that database and run `npm.cmd run test:security:postgres --workspace backend`. It exercises encryption, reviewer authorization/audit, and cross-instance partner idempotency behavior.

## Database commands

Run Prisma commands from `backend/`, or use the root workspace command form:

```powershell
npm.cmd run prisma:generate --workspace backend
npm.cmd run prisma:migrate --workspace backend
npm.cmd run prisma:push --workspace backend
```

Set `DATABASE_URL` in `backend/.env` before connecting to PostgreSQL. `prisma:migrate` applies checked-in Prisma migrations; `prisma:push` synchronizes the schema directly and is intended for development.
