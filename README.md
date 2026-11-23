# Cross-Border Payment Orchestration

The repository contains two independently configurable applications:

- `backend/` — Express API and payment orchestration modules, ISO 20022 processing, sanctions screening, treasury, ledger, simulated payment routing, and Prisma schema.
- `frontend-app/` — Next.js public landing page and consumer e-wallet app for registration, KYC submission, wallet top-ups, and PKR transfers to UAE/Saudi Arabia. It also includes a staff-only treasury liquidity dashboard.

The public site is served at `/`; consumer registration and sign-in are at `/register` and `/login`. Consumer wallet pages remain protected by consumer authentication. The treasury dashboard is at `/treasury` and requires an authorized staff session from the externally configured identity provider; this repository does not implement staff sign-in or provisioning.

## Requirements

- Node.js 20 or later
- npm
- PostgreSQL for Prisma database operations
- Prisma CLI and client are pinned by the lockfile to the same Prisma 6 release.
- The current queue implementation is in-memory; Redis is not currently wired into backend startup.

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

`backend/.env.example` contains placeholders, not usable credentials. Set distinct, randomly generated values for `JWT_SECRET`, `HMAC_SECRET`, `BANK_CALLBACK_HMAC_SECRET`, and `LEDGER_ADMIN_KEY` in `backend/.env`. Configure the KYC encryption keys and staff identity-provider settings described below before enabling KYC submissions or staff review. Never copy `DATABASE_URL` into a `NEXT_PUBLIC_*` frontend variable. The frontend environment file should contain only public browser configuration such as `NEXT_PUBLIC_BACKEND_URL`.

The backend defaults to port `5001` (the current project setting) and permits the consumer app at `http://localhost:3001`. Set `CONSUMER_FRONTEND_ORIGIN` to change that origin. The frontend defaults to the same backend port.

### Customer session security

Customer login and registration set a short-lived, HttpOnly, `SameSite=Strict` session cookie. The access JWT is no longer returned to or stored by frontend JavaScript. API requests use `credentials: include`. In production the cookie additionally requires `Secure`. State-changing cookie-authenticated requests are rejected unless the browser Origin matches the configured frontend origin.

Bearer JWT authentication remains temporarily supported for API compatibility, and staff authentication continues to use externally verified RS256 staff JWTs. `POST /api/v1/auth/logout` clears the browser cookie. This does not implement server-side JWT revocation or refresh-token rotation: a copied bearer token or cookie value may remain valid until JWT expiration. Distributed or persistent session invalidation requires a later session-store/migration phase.

### Neon and PostgreSQL connection configuration

The Prisma schema reads `DATABASE_URL`. Use the Neon **pooled** endpoint (hostname includes `-pooler`) for a long-running API with concurrent requests. Keep connection limits conservative per backend instance; the example uses `connection_limit=5`, `pool_timeout=10`, and `connect_timeout=10`. Include Neon’s TLS options and do not disable certificate validation.

For Prisma migrations, prefer Neon’s **direct** endpoint. The current schema has a single `DATABASE_URL`, so set that variable to the direct connection in the process environment for migration commands, without changing the saved application value in `backend/.env`. Do not put credentials in command history; load them from an approved secret manager or protected environment configuration. Use the same `DATABASE_URL` for the application’s pooled endpoint when starting the API.

Run sanitized, read-only database diagnostics from PowerShell:

```powershell
npm.cmd run db:diagnose --workspace backend
npm.cmd run db:test --workspace backend
```

The diagnostic reports Node and Prisma versions, hostname/database metadata, credential presence (not values), SSL/pooling configuration, DNS answers, a Prisma connection/read-only query, and a `pg` connection/read-only query with certificate verification enabled. It never prints the database URL or credentials. A strict `pg` certificate error should be fixed by configuring the provider’s CA chain; do not turn off TLS verification.

The installed Prisma CLI and client must remain on the same version. The current local installation was observed at Prisma `6.19.3` for both packages and successfully connected under Node `v24.21.0`; this does not establish that every endpoint/provider combination will work.

### Safe Prisma migration workflow

Generate the Prisma Client and check migration status before deployment:

```powershell
npm.cmd run prisma:generate --workspace backend
npm.cmd run db:migrate:status --workspace backend
```

Inspect every pending migration SQL file, confirm a verified backup and a dedicated target database, then explicitly enable deployment:

```powershell
$env:CONFIRM_MIGRATION_DEPLOY = "YES"
npm.cmd run db:migrate:deploy --workspace backend
Remove-Item Env:\CONFIRM_MIGRATION_DEPLOY
```

The deployment script verifies a database connection, checks migration status, and refuses to apply pending migrations without the explicit confirmation variable. It uses `prisma migrate deploy` only; it never resets the database. Do not use `prisma db push` as a migration strategy. The legacy `001_initial_ledger.sql` file is outside Prisma’s timestamped migration directories and is not automatically applied by Prisma.

### Backend health and connection troubleshooting

The backend validates its database URL and required secrets, connects to PostgreSQL, and runs a read-only readiness query before listening. `GET /health/live` (also available at legacy `GET /health`) reports process liveness only. `GET /health/ready` checks PostgreSQL and returns HTTP 503 with a sanitized response if the database is unavailable.

Common connection errors:

- **P1001** — Check that the configured hostname matches the intended provider/endpoint, DNS resolves it, port 5432 is reachable, and the database endpoint is active. The diagnostic includes DNS results and whether it is a Neon pooled endpoint. Do not switch direct/pooled endpoints without verifying which URL is configured.
- **P1000** — Verify the database username, password, and database grants using the provider console. Never paste credentials into logs or issue reports.
- **P1002 / ETIMEDOUT** — Check endpoint availability, pooler limits and per-instance `connection_limit`; use the bounded `connect_timeout` and `pool_timeout` settings rather than adding unbounded retries.
- **TLS errors** — Confirm the hostname and provider certificate chain. Keep TLS certificate verification enabled.
- **Node/Prisma mismatch** — Check the reported Node, Prisma CLI, and Prisma Client versions. This project’s installed Prisma 6.19.3 CLI and client matched in the local diagnostic; changing Node or upgrading Prisma should require a reproducible failure.

The local environment currently uses the port configured in `backend/.env`; do not assume port `5000` from a separate deployment configuration.

The partner payment-initiation endpoint requires `X-Client-Id`, `X-Idempotency-Key`, a current ISO timestamp in `X-Timestamp`, and an HMAC-SHA256 hex signature in `X-Signature`. The signature covers the JSON serialization of `{ "clientId": "...", "timestamp": "...", "idempotencyKey": "...", "body": <request JSON> }`. Idempotency records are stored in PostgreSQL and retained for 90 days; run `npm.cmd run security:purge-partner-idempotency --workspace backend` periodically to remove expired final records. The external callback endpoint uses `BANK_CALLBACK_HMAC_SECRET`; the separately named simulated callback endpoint uses `HMAC_SECRET`. Both require a timestamped signature over `{ "timestamp": "...", "body": <callback JSON> }`. Authenticated callbacks are durably recorded and deduplicated, but receipt does not update a transfer or prove settlement. Consumer JWTs are HS256 tokens issued for the `consumer-app` audience.

### KYC document encryption and reviewer identity

KYC document uploads require application-layer AES-256-GCM envelope encryption. Each file gets a random data-encryption key; the KEK wraps that key and is supplied externally, never stored in PostgreSQL. Configure `KYC_KEK_KEYS_JSON` as a JSON object mapping version identifiers to base64-encoded 32-byte keys, and set `KYC_KEK_ACTIVE_VERSION` to one of those versions. For local-only development, generate a key with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"` and keep it outside source control. The local environment-variable provider is not a cloud KMS and is not production-grade key management. Production deployment requires a separately managed secret/KMS provider and operational key backup/access controls.

Staff authentication is delegated to an external identity provider. Configure `STAFF_JWT_PUBLIC_KEY` (PEM; newlines may be represented as `\\n`), `STAFF_JWT_ISSUER`, and `STAFF_JWT_AUDIENCE`. The IdP must issue RS256 JWTs with a `sub` identifying the individual and a `roles` array containing `KYC_REVIEWER` and/or `KYC_ADMIN`. Reviewers can approve/reject pending KYC; administrators can make traceable corrections. Both roles can view attributed review history and access documents. This repository does not implement staff login, staff provisioning, or an IdP. Do not issue shared staff credentials.

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

The backend health endpoint is `http://localhost:5001/health`.
The consumer wallet app and public site are available at `http://localhost:3001`. It requires KYC approval to send. Authenticated `KYC_REVIEWER` or `KYC_ADMIN` staff can list pending applicants with `GET /api/v1/admin/kyc`, retrieve an encrypted submitted file through `GET /api/v1/admin/kyc/:userId/documents/:documentId`, and approve or reject an application with `POST /api/v1/admin/kyc/:userId/review`. Review decisions require a reason and are recorded as append-only attributed events. `KYC_ADMIN` can record a linked correction rather than changing a prior review. Top-ups and payouts are simulated in this prototype and do not move real funds.

Staff with `TREASURY_VIEWER`, `TREASURY_OPERATOR`, or `TREASURY_ADMIN` can view `GET /api/treasury/liquidity/alerts` and the `/treasury` dashboard. Acknowledging an alert requires `TREASURY_OPERATOR` or `TREASURY_ADMIN` and records an audit event only. Liquidity suggestions do not execute rebalance actions.
Every KYC document download, as well as authorized document-related authentication failures and authorization denials, records metadata in the existing append-only audit infrastructure. Audit records contain staff identifier, action, outcome, reason, document/user identifiers, and request correlation ID; document bytes, identity numbers, secrets, and tokens are not written to audit metadata.
The consumer wallet app is available at `http://localhost:3001`. It requires KYC approval to send. Authenticated `KYC_REVIEWER` or `KYC_ADMIN` staff can list pending applicants with `GET /api/v1/admin/kyc`, retrieve an encrypted submitted file through `GET /api/v1/admin/kyc/:userId/documents/:documentId`, and approve or reject an application with `POST /api/v1/admin/kyc/:userId/review`. Staff requests use `Authorization: Bearer <staff JWT>`; review decisions require a reason and are recorded as append-only attributed events. `KYC_ADMIN` can record a linked correction rather than changing a prior review. Top-ups and payouts are simulated in this prototype and do not move real funds.

### Consumer transfer and beneficiary APIs

Consumer requests use `Authorization: Bearer <consumer JWT>`. Available customer routes include:

| Method | Route | Behavior |
|---|---|---|
| `POST` | `/api/v1/auth/register` | Creates a consumer account; response includes a consumer JWT and public user fields only. |
| `POST` | `/api/v1/auth/login` | Verifies consumer credentials and returns a JWT for the `consumer-app` audience. |
| `POST` | `/api/v1/auth/kyc` | Authenticated multipart document submission; requires configured encrypted KYC storage and accepted document content. |
| `POST` | `/api/v1/wallet/topup` | Creates a simulated top-up with an idempotency reference; this is not a real payment rail deposit. |
| `POST` | `/api/v1/fx/quote` | Authenticated quote request; accepts optional `X-Idempotency-Key` and persists the quote, expiry and rate source. |
| `POST` | `/api/v1/transfers/send` | Authenticated transfer creation; requires `X-Idempotency-Key`, payment PIN, owned beneficiary and matching active quote. Wallet/ledger updates and quote consumption are transactional; execution remains simulated. |
| `GET` | `/api/v1/transfers?page=1&pageSize=10&status=SIMULATED&query=...` | Lists only the authenticated customer’s transfers; supports status, exact UETR search, recipient-name search, and pages up to 50 records. Returns counts and decimal-string source volume summaries. |
| `GET` | `/api/v1/transfers?page=1&pageSize=10&status=SIMULATED&query=...&from=2026-01-01T00:00:00Z&to=2026-01-31T23:59:59Z` | Customer history supports bounded pagination, status filtering, reference/recipient search, and optional ISO 8601 creation-date bounds. |
| `GET` | `/api/v1/transfers/:transferId` | Returns a transfer, customer-safe lifecycle presentation, and ordered normalized timeline only if it belongs to the authenticated customer. |
| `GET` | `/api/v1/routing/strategies` | Lists supported routing strategies and public scoring weights. |
| `POST` | `/api/v1/routing/preview` | Authenticated, estimate-only route comparison. May include an owned active `quoteId`; otherwise uses the static demonstration FX rate when available. |
| `GET` | `/api/v1/transfers/:transferId/routing` | Returns the recorded simulated decision only for a transfer owned by the authenticated customer. |
| `GET` | `/api/v1/beneficiaries` | Lists the authenticated customer’s saved recipients. |
| `POST` | `/api/v1/beneficiaries` | Creates a recipient after server-side IBAN/BIC format validation. |
| `PUT` | `/api/v1/beneficiaries/:beneficiaryId` | Updates an owned recipient only if it has no transfer history; revalidates IBAN/BIC. |
| `DELETE` | `/api/v1/beneficiaries/:beneficiaryId` | Deletes an owned recipient only if unused in transfer history. |

Format validation does not establish bank-account ownership. Recipient details attached to a transfer are locked from edit/delete to preserve historical references. The `/transfers` customer page provides searchable, paginated demo history; transfer detail pages can be printed or saved as a browser-generated receipt. These are simulation records only and are not bank confirmations or settlement receipts.

### Simulated payment routing

The routing service evaluates configured simulated adapters for `PK_AE`, `AE_PK`, `PK_SA`, and `SA_PK`. It supports `LOWEST_COST`, `FASTEST`, and `BALANCED` strategies. The cost, processing-time, and operational-risk components are normalized against the eligible candidate set and combined using the configured strategy weights; each strategy’s three weights must be nonnegative and sum exactly to `1`. Defaults are lowest-cost `0.70/0.10/0.20`, fastest `0.15/0.70/0.15`, and balanced `0.40/0.35/0.25` (cost/speed/risk). These may be overridden with the nine `ROUTING_<STRATEGY>_<COST|SPEED|RISK>_WEIGHT` variables in `backend/.env`.

All adapters and figures are fictional test configuration, not partner connections, available funds, live provider status, or measured performance. Their current demonstration profiles are:

| Adapter | Estimated time | Configured risk score | Fee estimate |
|---|---:|---:|---|
| `SIM_FAST` | 45 minutes | 35/100 | 350 PKR or 1.50 AED/SAR plus 0.35% |
| `SIM_ECONOMY` | 240 minutes | 20/100 | 100 PKR or 0.50 AED/SAR plus 0.15% |
| `SIM_STANDARD` | 120 minutes | 15/100 | 200 PKR or 1.00 AED/SAR plus 0.25% |

Each adapter is statically marked simulated-available and has simulated test capacity of 50,000,000 PKR or 500,000 AED/SAR. Route estimates use Prisma Decimal arithmetic, are returned as currency-formatted strings, and never combine values across currencies. Estimated adapter fees are for comparison only: they are not added to the customer quote, deducted from the wallet, or posted to the ledger. A customer send uses the owned, active FX quote’s rate; a preview without a quote is marked `STATIC_DEMO` if the configured static rate exists. Preview results are not promises of execution.

Transfer creation selects according to the requested `routingStrategy` (default `BALANCED`) after validating the customer quote and before the existing simulated lifecycle continues. It stores a `ROUTE_SELECTED` decision in the existing transfer `timeline` JSON; no migration is required. The existing idempotency, ledger, quote-consumption, and atomic transaction rules remain authoritative. There is no customer or staff retry operation for changing a route after transfer creation.

Treasury staff can query `GET /api/treasury/routing/analytics` with a viewer, operator, or admin role. It reports selection counts, corridor breakdowns, rejected-route reasons, recent persisted comparisons, and the static simulated adapter profiles. At most the newest 1,000 transfer records are scanned. The frontend displays these results as simulated estimates, not actual rail performance.

### Staff operations and compliance consoles

The staff consoles are available at `/operations`, `/treasury`, and `/compliance`. Staff JWTs are issued by the configured external identity provider; the consumer sign-in page does not provision staff accounts. Authorization is enforced on the API, not just by hiding frontend controls.

| Method | Route | Required role(s) | Behavior |
|---|---|---|---|
| `GET` | `/api/treasury/operations/summary` | `TREASURY_VIEWER`, `TREASURY_OPERATOR`, `TREASURY_ADMIN` | Persisted transfer counts, status counts, currency/corridor source volumes, pending KYC count, unexpired quote count, and recent status/audit activity. Money totals remain grouped by currency and are never added across currencies. |
| `GET` | `/api/treasury/operations/transfers?page=1&pageSize=20&query=...&status=FAILED&currency=PKR&corridor=PK_AE` | Treasury viewer/operator/admin | Staff transfer queue with server-side filters and pagination. Search targets transfer UETR or internal transaction reference. Customer bank-account details are not returned. |
| `GET` | `/api/treasury/operations/transfers/:transferId` | Treasury viewer/operator/admin | Transfer state events, failure reasons, minimal recipient details, routing corridor/rail configuration, ISO message metadata and callback-inbox metadata. Raw XML, callback payloads, and bank account numbers are excluded. |
| `GET` | `/api/treasury/fx/quotes` | Treasury viewer/operator/admin | Up to 50 persisted, unexpired quote records with rate source, spread, spread revenue and expiry. It does not expose customer identifiers. |
| `GET` | `/api/treasury/routing/analytics` | Treasury viewer/operator/admin | Selection counts, corridor breakdowns, rejection reasons, simulated provider profiles, and recent routing decisions from at most the newest 1,000 transfers. |
| `GET` | `/api/v1/admin/kyc` | `KYC_REVIEWER`, `KYC_ADMIN` | Lists pending applicants and document metadata only. |
| `GET` | `/api/v1/admin/kyc/:userId/documents/:documentId` | `KYC_REVIEWER`, `KYC_ADMIN` | Decrypts and returns the selected document only when KYC encryption is configured. This is sensitive identity data. |
| `GET` | `/api/v1/admin/kyc/:userId/reviews` | `KYC_REVIEWER`, `KYC_ADMIN` | Returns attributed review/correction history and reasons. |
| `POST` | `/api/v1/admin/kyc/:userId/review` | `KYC_REVIEWER` | Approves/rejects a pending application; a reason is required and the status change plus review event are transactional. |
| `POST` | `/api/v1/admin/kyc/:userId/corrections` | `KYC_ADMIN` | Adds a linked correction event for a previously finalized decision; prior review history is retained. |

Operations summary statistics are computed from persisted application records. `SIMULATED` is not a bank-confirmed successful payment. Transfer volume is grouped by source currency; values in PKR, AED and SAR must not be summed as though they shared a unit. Liquidity warnings use configured balance records and thresholds; the dashboard does not invent liquidity or execute funding actions. Rates marked `STATIC_DEMO` are not live rates. Available quotes expose their persisted spread and spread-revenue values; the quote schema does not persist the customer fee as a separate quote component, so the console does not fabricate one. Transfer state changes and retry controls are not exposed in the operations console.

### Webhook and idempotency behavior

The integration currently implements inbound HTTP receivers, not outbound webhook subscriptions or delivery. There are no webhook registration, event configuration, outbound delivery history, background retry, or customer-controlled retry endpoints.

`POST /api/v1/webhooks/bank-callback` validates an HMAC signature using `BANK_CALLBACK_HMAC_SECRET`; `POST /api/v1/webhooks/simulated-callback` uses `HMAC_SECRET`. Both require `X-Timestamp` within the replay-protection window and `X-Signature` over `{ "timestamp": "<timestamp>", "body": <callback JSON> }`. The payload is schema-validated and stored in `callback_inbox`, whose `(source, messageId)` unique key prevents duplicate handling. Reuse of a message ID with a different payload is rejected with HTTP 409. Identical retries return an idempotent duplicate acknowledgment. Inbound callbacks are persisted for audit but do not change transfer or ledger state; simulated callbacks are marked `IGNORED_SIMULATED`. No delivery retry schedule applies because this service does not send outbound webhooks.

Partner initiation uses HMAC plus a required idempotency key and stores responses in PostgreSQL for 90 days. Consumer quote keys prevent reusing a key with different quote details; transfer creation consumes a quote and performs wallet/ledger updates transactionally. Do not retry an uncertain payment operation under a new key until its persisted status is investigated.

Most API failures return JSON `{ "error": "..." }`. Common responses are `400` for invalid input, `401` for missing/invalid authentication or signatures, `403` for an authenticated but unauthorized role or KYC state, `404` for missing/unauthorized-to-view records, `409` for conflicting state or idempotency reuse, `422` for an expired FX quote, `429` for throttling, and `503` when a required service/configuration is unavailable. Partner initiation can return `202` while a matching idempotency record is still `PROCESSING`; a changed payload with the same key returns `409`. Internal exception details are not part of the public error contract.

## Ledger accounting model

Ledger entries retain their original currency and amount, while each entry is valued in USD for reporting at the configured USD-per-currency rate. Cross-currency journals route the difference through an explicit USD FX position-clearing account; disclosed fees, FX spread revenue, and residual valuation gains or losses are recorded separately. Journal debits and credits must balance exactly at the ledger's four-decimal USD reporting precision. Wallet balances and shadow-account postings are updated within the same database transaction. These records model simulated activity only and are not evidence of bank settlement.

FX quotes are persisted per customer with their rate observation time, provider label, expiry, state, and eventual transfer association. A quote can be consumed only once, and consumption commits atomically with the wallet transfer. The current rate feed is static demo data; stale or malformed observations are rejected rather than represented as live market pricing. Restarting the backend does not reset persisted quote state.

Quote freshness, bid/ask spread, market-reference deviation, and client-pricing deviation have separate `FX_MAX_*` configuration limits. Reference rates are static demo baselines, not independent market validation. ISO 20022 serialization writes the destination settlement amount/currency in `IntrBkSttlmAmt`; parsed amounts remain Prisma Decimal values to avoid binary floating-point conversion.

Treasury liquidity alerts validate nonnegative balances, reserved amounts, thresholds, targets, currency precision, and configured counterparty codes using decimal arithmetic. Rebalance amounts are recommendations only; the prototype does not execute liquidity injections or sweeps.

Transfers use a centralized, explicit lifecycle for `INITIATED`, `VALIDATING`, `QUOTED`, `FUNDS_DEBITED`, `SUBMITTED`, `ACCEPTED`, `SETTLED`, `FAILED`, `REJECTED`, `RETURNED`, `CANCELLED`, `SIMULATED`, and `REVERSED`. Invalid transitions and terminal-state reopening are rejected. The consumer demo ends at `SIMULATED`; it does not report bank acceptance or settlement. Legacy `COMPLETED` and `SETTLED` transfer rows are migrated to `SIMULATED`. Posted ledger entries and status events cannot be updated or deleted in PostgreSQL; corrections require compensating financial records. The reviewer-only `POST /api/v1/admin/transactions/:transactionId/reverse` endpoint accepts a required reason and creates a wallet-balanced compensating journal for eligible wallet activity; it only reverses simulated transfers and requires `LEDGER_ADMIN_KEY`. KYC states are constrained, and beneficiary bank details are marked `FORMAT_VALIDATED` only after IBAN/BIC format checks; ownership is not confirmed.

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
npm.cmd run db:migrate:status --workspace backend
```

Use `npm.cmd run db:migrate:deploy --workspace backend` only after reviewing pending migration SQL and explicitly setting `CONFIRM_MIGRATION_DEPLOY=YES` as described above. `prisma:push` is retained only for disposable development environments and must not replace the checked-in migration history.
