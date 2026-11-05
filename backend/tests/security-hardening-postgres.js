import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import express from 'express';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { createConsumerRouter } from '../src/gateway/consumer-routes.js';
import { handleInitiatePayment } from '../src/gateway/routes.js';
import { generateHmacSignature } from '../src/gateway/security.js';
import {
  KycDocumentEncryptionService,
  LocalEnvelopeKeyProvider,
} from '../src/gateway/kyc-encryption.js';
import { verifyStaffSession } from '../src/gateway/staff-auth.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('TEST_DATABASE_URL must point to a dedicated PostgreSQL test database');
const parsedUrl = new URL(databaseUrl);
const databaseName = parsedUrl.pathname.slice(1);
if (!['localhost', '127.0.0.1', '::1'].includes(parsedUrl.hostname)
  || !/(^|[_-])test([_-]|$)/i.test(databaseName)) {
  throw new Error('Refusing to run security tests: use a localhost database with "test" in its name');
}

process.env.DATABASE_URL = databaseUrl;
process.env.JWT_SECRET = 'test-only-consumer-jwt-secret-at-least-32-characters';
process.env.STAFF_JWT_ISSUER = 'https://staff-idp.example.test/';
process.env.STAFF_JWT_AUDIENCE = 'crossborder-kyc-review';
process.env.KYC_KEK_ACTIVE_VERSION = 'test-v1';

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const prisma = new PrismaClient();
const namespace = randomBytes(8).toString('hex');
const consumerSecret = process.env.JWT_SECRET;
const partnerSecret = 'test-only-partner-hmac-secret-is-at-least-32-bytes';
const keks = new Map([
  ['test-v1', randomBytes(32)],
  ['test-v2', randomBytes(32)],
]);
process.env.KYC_KEK_KEYS_JSON = JSON.stringify(
  Object.fromEntries([...keks].map(([version, key]) => [version, key.toString('base64')]))
);

const currentEncryption = new KycDocumentEncryptionService(
  new LocalEnvelopeKeyProvider({ keys: keks, activeVersion: 'test-v1' })
);
const rotatedEncryption = new KycDocumentEncryptionService(
  new LocalEnvelopeKeyProvider({ keys: keks, activeVersion: 'test-v2' })
);

const { privateKey: staffPrivateKey, publicKey: staffPublicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
});
process.env.STAFF_JWT_PUBLIC_KEY = staffPublicKey.export({ type: 'spki', format: 'pem' });

const testPayload = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

function assertThrows(fn, message) {
  assert.throws(fn, undefined, message);
}

function consumerToken(userId) {
  return jwt.sign({}, consumerSecret, {
    subject: userId,
    expiresIn: '1h',
    issuer: 'crossborder-payment-orchestrator',
    audience: 'consumer-app',
    algorithm: 'HS256',
  });
}

function staffToken(subject, roles) {
  return jwt.sign({ roles }, staffPrivateKey, {
    subject,
    expiresIn: '1h',
    issuer: process.env.STAFF_JWT_ISSUER,
    audience: process.env.STAFF_JWT_AUDIENCE,
    algorithm: 'RS256',
  });
}

async function seedKycUser(label) {
  const user = await prisma.user.create({
    data: {
      fullName: `KYC Integration ${label}`,
      email: `kyc-${namespace}-${label.toLowerCase()}@example.test`,
      phone: `+1444${namespace.slice(0, 8)}${createHash('sha256').update(label).digest('hex').slice(0, 3)}`,
      passwordHash: 'test-not-used',
      pinHash: 'test-not-used',
    },
  });
  return { user, token: consumerToken(user.id) };
}

function makeConsumerApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1', createConsumerRouter({
    prisma,
    orchestrator: {},
    kycEncryption: currentEncryption,
    staffTokenVerifier: token => verifyStaffSession(token),
  }));
  return app;
}

function listen(app) {
  const server = app.listen(0, '127.0.0.1');
  return new Promise((resolve, reject) => {
    server.once('listening', () => resolve({
      server,
      baseUrl: `http://127.0.0.1:${server.address().port}`,
    }));
    server.once('error', reject);
  });
}

async function close(server) {
  if (server?.listening) await new Promise(resolve => server.close(resolve));
}

async function postJson(baseUrl, route, body, token, headers = {}) {
  const response = await fetch(`${baseUrl}/api/v1${route}`, {
    method: 'POST',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

async function uploadKycDocument(baseUrl, customer) {
  const form = new FormData();
  form.set('documentType', 'PASSPORT');
  form.set('document', new Blob([testPayload], { type: 'image/png' }), 'passport.png');
  const response = await fetch(`${baseUrl}/api/v1/auth/kyc`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${customer.token}` },
    body: form,
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

function partnerPayload() {
  return {
    corridorCode: 'PK_AE',
    instructedAmount: 1000,
    instructedCurrency: 'PKR',
    targetCurrency: 'AED',
    senderBic: 'MEZNBPKK',
    senderIban: 'PK67MEZN0000001123456701',
    senderName: 'Partner Test Sender',
    receiverBic: 'FABAEADU',
    receiverIban: 'AE070331234567890123456',
    receiverName: 'Partner Test Receiver',
  };
}

function makePartnerApp(paymentProcessor, database = prisma) {
  const app = express();
  app.use(express.json());
  app.post('/api/v1/payments/initiate', (req, res) => {
    void handleInitiatePayment(req, res, {
      orchestrator: paymentProcessor,
      rateLimiter: null,
      hmacSecret: partnerSecret,
      prisma: database,
    });
  });
  return app;
}

async function signedPartnerRequest(baseUrl, partnerId, idempotencyKey, body) {
  const timestamp = new Date().toISOString();
  const signature = generateHmacSignature({
    clientId: partnerId,
    timestamp,
    idempotencyKey,
    body,
  }, partnerSecret);
  const response = await fetch(`${baseUrl}/api/v1/payments/initiate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Client-Id': partnerId,
      'X-Timestamp': timestamp,
      'X-Idempotency-Key': idempotencyKey,
      'X-Signature': signature,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

async function testEncryptionAndKycRoutes() {
  const documentId = randomBytes(16).toString('hex');
  const encrypted = currentEncryption.encrypt(documentId, testPayload);
  const encryptedDocument = { id: documentId, ...encrypted };
  assert(currentEncryption.decrypt(encryptedDocument).equals(testPayload), 'KYC AES-GCM encrypt/decrypt roundtrip');

  const changedCiphertext = {
    ...encryptedDocument,
    ciphertext: Buffer.from(encryptedDocument.ciphertext),
  };
  changedCiphertext.ciphertext[0] ^= 0x01;
  assertThrows(() => currentEncryption.decrypt(changedCiphertext), 'Modified KYC ciphertext must be rejected');

  const changedTag = {
    ...encryptedDocument,
    authenticationTag: Buffer.from(encryptedDocument.authenticationTag),
  };
  changedTag.authenticationTag[0] ^= 0x01;
  assertThrows(() => currentEncryption.decrypt(changedTag), 'Invalid KYC authentication tag must be rejected');

  const rotatedKeyMetadata = rotatedEncryption.rotateWrappedDataKey(encryptedDocument);
  assert.equal(rotatedKeyMetadata.keyVersion, 'test-v2', 'KYC key rotation must use the active KEK version');
  assert(
    rotatedEncryption.decrypt({ ...encryptedDocument, ...rotatedKeyMetadata }).equals(testPayload),
    'KYC document remains decryptable after envelope-key rotation'
  );
  const noOldKeyEncryption = new KycDocumentEncryptionService(
    new LocalEnvelopeKeyProvider({ keys: new Map([['test-v2', keks.get('test-v2')]]), activeVersion: 'test-v2' })
  );
  assertThrows(
    () => noOldKeyEncryption.decrypt(encryptedDocument),
    'Removing an old KEK before rotating documents must make the old envelope unavailable'
  );
  assertThrows(
    () => currentEncryption.decrypt({ id: documentId, fileData: testPayload }),
    'Legacy plaintext must never be treated as encrypted data'
  );

  const customer = await seedKycUser('ONE');
  const { server, baseUrl } = await listen(makeConsumerApp());
  try {
    const upload = await uploadKycDocument(baseUrl, customer);
    assert.equal(upload.status, 202, 'Consumer KYC submission remains available');
    const savedDocument = await prisma.kycDocument.findUnique({
      where: { id: upload.body.documentId },
    });
    assert.equal(savedDocument.fileData, null, 'New KYC documents must not retain plaintext bytes');
    assert(currentEncryption.decrypt(savedDocument).equals(testPayload), 'Stored KYC ciphertext decrypts only through the encryption service');

    const documentPath = `/admin/kyc/${customer.user.id}/documents/${savedDocument.id}`;
    const unauthenticated = await fetch(`${baseUrl}/api/v1${documentPath}`);
    assert.equal(unauthenticated.status, 401, 'Unauthenticated KYC document access must be denied');
    const consumerAccess = await fetch(`${baseUrl}/api/v1${documentPath}`, {
      headers: { Authorization: `Bearer ${customer.token}` },
    });
    assert.equal(consumerAccess.status, 401, 'Consumer JWT must not authorize reviewer document access');

    const reviewer = staffToken('reviewer-user-17', ['KYC_REVIEWER']);
    const authorizedDownload = await fetch(`${baseUrl}/api/v1${documentPath}`, {
      headers: { Authorization: `Bearer ${reviewer}` },
    });
    assert.equal(authorizedDownload.status, 200, 'Authenticated reviewer can retrieve an encrypted document');
    assert(
      Buffer.from(await authorizedDownload.arrayBuffer()).equals(testPayload),
      'Authorized download returns the original document bytes'
    );

    const legacy = await prisma.kycDocument.create({
      data: {
        userId: customer.user.id,
        documentType: 'PASSPORT',
        fileName: 'legacy.png',
        mimeType: 'image/png',
        fileData: testPayload,
      },
    });
    const legacyPath = `/admin/kyc/${customer.user.id}/documents/${legacy.id}`;
    const legacyBeforeMigration = await fetch(`${baseUrl}/api/v1${legacyPath}`, {
      headers: { Authorization: `Bearer ${reviewer}` },
    });
    assert.equal(legacyBeforeMigration.status, 409, 'Legacy plaintext documents require explicit migration');

    const script = path.join(backendRoot, 'scripts', 'encrypt-legacy-kyc-documents.js');
    const migration = spawnSync(process.execPath, [script], {
      cwd: backendRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        CONFIRM_KYC_LEGACY_ENCRYPTION: 'YES',
      },
    });
    assert.equal(migration.status, 0, `Explicit KYC document migration failed: ${migration.stderr}`);
    const migratedLegacy = await prisma.kycDocument.findUnique({ where: { id: legacy.id } });
    assert.equal(migratedLegacy.fileData, null, 'Explicit legacy migration clears plaintext after encryption');
    assert(currentEncryption.decrypt(migratedLegacy).equals(testPayload), 'Explicitly migrated legacy document decrypts');
    const legacyAfterMigration = await fetch(`${baseUrl}/api/v1${legacyPath}`, {
      headers: { Authorization: `Bearer ${reviewer}` },
    });
    assert.equal(legacyAfterMigration.status, 200, 'Migrated legacy document is available to an authorized reviewer');

    const latestVersion = await prisma.kycDocument.findUnique({ where: { id: savedDocument.id } });
    const corruptedCiphertext = Buffer.from(latestVersion.ciphertext);
    corruptedCiphertext[0] ^= 0x80;
    await prisma.kycDocument.update({
      where: { id: latestVersion.id },
      data: { ciphertext: corruptedCiphertext },
    });
    const corruptDownload = await fetch(`${baseUrl}/api/v1${documentPath}`, {
      headers: { Authorization: `Bearer ${reviewer}` },
    });
    assert.equal(corruptDownload.status, 500, 'Tampered stored KYC ciphertext must fail closed');
    const corruptResponse = await corruptDownload.json();
    assert.equal(corruptResponse.error, 'KYC document could not be decrypted', 'Decrypt errors must not expose document or key material');
  } finally {
    await close(server);
  }
}

async function testReviewerIdentityAndAudit() {
  const first = await seedKycUser('TWO');
  const concurrent = await seedKycUser('THREE');
  const app = makeConsumerApp();
  const { server, baseUrl } = await listen(app);
  try {
    for (const customer of [first, concurrent]) {
      const upload = await uploadKycDocument(baseUrl, customer);
      assert.equal(upload.status, 202, 'Applicant can submit KYC before staff review');
    }

    const applicantListUnauthorized = await fetch(`${baseUrl}/api/v1/admin/kyc`);
    assert.equal(applicantListUnauthorized.status, 401, 'KYC queue requires a staff session');
    const adminOnly = staffToken('kyc-admin-2', ['KYC_ADMIN']);
    const reviewerOnly = staffToken('kyc-reviewer-9', ['KYC_REVIEWER']);
    const adminCanNotActAsReviewer = await postJson(
      baseUrl,
      `/admin/kyc/${first.user.id}/review`,
      { status: 'APPROVED', reason: 'Reviewed passport and identity match' },
      adminOnly
    );
    assert.equal(adminCanNotActAsReviewer.status, 403, 'KYC administrator role cannot perform reviewer approval');

    const unauthorizedApproval = await postJson(
      baseUrl,
      `/admin/kyc/${first.user.id}/review`,
      { status: 'APPROVED', reason: 'Reviewed passport and identity match' },
      null
    );
    assert.equal(unauthorizedApproval.status, 401, 'KYC approval without a staff session is denied');

    const review = await postJson(
      baseUrl,
      `/admin/kyc/${first.user.id}/review`,
      { status: 'APPROVED', reason: 'Passport details match the submitted application' },
      reviewerOnly
    );
    assert.equal(review.status, 200, `Authorized KYC reviewer approval: ${JSON.stringify(review.body)}`);
    assert.equal(review.body.review.reviewerId, 'kyc-reviewer-9', 'Review event attributes the individual reviewer');
    assert.equal(review.body.review.reviewerIssuer, process.env.STAFF_JWT_ISSUER, 'Review event records the trusted identity issuer');
    assert.equal(review.body.review.decision, 'APPROVED', 'Review event records the decision');
    assert.equal(review.body.review.reason, 'Passport details match the submitted application', 'Review event records the reason');

    const correction = await postJson(
      baseUrl,
      `/admin/kyc/${first.user.id}/corrections`,
      { status: 'REJECTED', reason: 'Correction: the passport image was materially altered' },
      adminOnly
    );
    assert.equal(correction.status, 200, `KYC administrator correction: ${JSON.stringify(correction.body)}`);
    assert.equal(correction.body.correction.action, 'CORRECTION', 'Status correction creates an explicit correction audit event');
    assert.equal(correction.body.correction.correctionOfId, review.body.review.id, 'Correction links to the prior review');
    assert.equal(correction.body.correction.reviewerId, 'kyc-admin-2', 'Correction records the administrator identity');
    const reviewHistory = await fetch(`${baseUrl}/api/v1/admin/kyc/${first.user.id}/reviews`, {
      headers: { Authorization: `Bearer ${adminOnly}` },
    });
    assert.equal(reviewHistory.status, 200, 'KYC administrator can inspect append-only review history');
    assert.equal((await reviewHistory.json()).reviews.length, 2, 'Original decision and correction are both retained');
    await assert.rejects(
      prisma.kycReviewEvent.update({
        where: { id: review.body.review.id },
        data: { reason: 'silently modified' },
      }),
      /KYC review events are append-only/
    );
    await assert.rejects(
      prisma.kycReviewEvent.delete({ where: { id: review.body.review.id } }),
      /KYC review events are append-only/
    );

    const simultaneousReviews = await Promise.all([
      postJson(
        baseUrl,
        `/admin/kyc/${concurrent.user.id}/review`,
        { status: 'APPROVED', reason: 'Concurrent review decision A' },
        staffToken('reviewer-a', ['KYC_REVIEWER'])
      ),
      postJson(
        baseUrl,
        `/admin/kyc/${concurrent.user.id}/review`,
        { status: 'REJECTED', reason: 'Concurrent review decision B' },
        staffToken('reviewer-b', ['KYC_REVIEWER'])
      ),
    ]);
    assert.equal(simultaneousReviews.filter(result => result.status === 200).length, 1, 'Only one concurrent reviewer can decide a pending application');
    assert.equal(simultaneousReviews.filter(result => result.status === 409).length, 1, 'Concurrent losing reviewer receives a conflict');
    assert.equal(
      await prisma.kycReviewEvent.count({ where: { userId: concurrent.user.id } }),
      1,
      'Only the winning concurrent reviewer decision is audited'
    );
  } finally {
    await close(server);
  }
}

async function testPartnerIdempotencyAndRecovery() {
  const partnerId = `partner-${namespace}`;
  const idempotencyKey = `partner-key-${namespace}`;
  let instanceOneCalls = 0;
  let instanceTwoCalls = 0;
  const processorOne = {
    async processPayment() {
      instanceOneCalls += 1;
      await new Promise(resolve => setTimeout(resolve, 80));
      return {
        success: true,
        executionMode: 'SIMULATED',
        settlementVerified: false,
        uetr: randomBytes(16).toString('hex'),
      };
    },
  };
  const processorTwo = {
    async processPayment() {
      instanceTwoCalls += 1;
      return {
        success: true,
        executionMode: 'SIMULATED',
        settlementVerified: false,
        uetr: randomBytes(16).toString('hex'),
      };
    },
  };
  const first = await listen(makePartnerApp(processorOne));
  const second = await listen(makePartnerApp(processorTwo));
  try {
    const payload = partnerPayload();
    const duplicates = await Promise.all([
      signedPartnerRequest(first.baseUrl, partnerId, idempotencyKey, payload),
      signedPartnerRequest(second.baseUrl, partnerId, idempotencyKey, payload),
    ]);
    assert(duplicates.every(result => result.status === 200), 'Concurrent identical partner requests return the same completed response');
    assert.equal(instanceOneCalls + instanceTwoCalls, 1, 'Multiple backend instances share one durable execution');
    assert.deepEqual(duplicates[0].body, duplicates[1].body, 'Duplicate requests receive the persisted final response');

    const changedPayload = { ...payload, instructedAmount: 1200 };
    const changedKeyResponse = await signedPartnerRequest(second.baseUrl, partnerId, idempotencyKey, changedPayload);
    assert.equal(changedKeyResponse.status, 409, 'Existing partner key with a different canonical payload is rejected');
    assert.equal(instanceOneCalls + instanceTwoCalls, 1, 'Payload mismatch must not invoke payment processing');

    const stored = await prisma.partnerIdempotency.findUnique({
      where: { partnerId_idempotencyKey: { partnerId, idempotencyKey } },
    });
    assert.equal(stored.status, 'COMPLETED', 'Partner execution status is durable');
    assert.equal(stored.requestHash.length, 64, 'Canonical request hash is stored');
    assert(
      Math.abs(stored.expiresAt.getTime() - stored.createdAt.getTime() - 90 * 24 * 60 * 60 * 1000) <= 5000,
      'Partner idempotency retention is 90 days within database timestamp precision'
    );
  } finally {
    await Promise.all([close(first.server), close(second.server)]);
  }

  let afterRestartCalls = 0;
  const restarted = await listen(makePartnerApp({
    async processPayment() {
      afterRestartCalls += 1;
      throw new Error('Completed request must not execute again after restart');
    },
  }));
  try {
    const recovered = await signedPartnerRequest(
      restarted.baseUrl,
      partnerId,
      idempotencyKey,
      partnerPayload()
    );
    assert.equal(recovered.status, 200, 'Completed response is recovered after backend restart');
    assert.equal(afterRestartCalls, 0, 'Server restart replay never invokes payment processing');
  } finally {
    await close(restarted.server);
  }

  let failureCalls = 0;
  const failingServer = await listen(makePartnerApp({
    async processPayment() {
      failureCalls += 1;
      throw new Error('synthetic processing failure');
    },
  }));
  const failedKey = `partner-failed-${namespace}`;
  try {
    const failed = await signedPartnerRequest(
      failingServer.baseUrl,
      partnerId,
      failedKey,
      partnerPayload()
    );
    assert.equal(failed.status, 422, 'Processing failure is stored as a final safe failure response');
    const duplicateFailure = await signedPartnerRequest(
      failingServer.baseUrl,
      partnerId,
      failedKey,
      partnerPayload()
    );
    assert.equal(duplicateFailure.status, 422, 'Failed request replay returns its durable failure result');
    assert.equal(failureCalls, 1, 'A failed idempotency key is not executed a second time');
    assert.equal(
      (await prisma.partnerIdempotency.findUnique({
        where: { partnerId_idempotencyKey: { partnerId, idempotencyKey: failedKey } },
      })).status,
      'FAILED',
      'Final failure state persists in PostgreSQL'
    );
  } finally {
    await close(failingServer.server);
  }

  let restartedFailureCalls = 0;
  const failureRestart = await listen(makePartnerApp({
    async processPayment() {
      restartedFailureCalls += 1;
      throw new Error('Failed request must be recovered without a retry');
    },
  }));
  try {
    const recoveredFailure = await signedPartnerRequest(
      failureRestart.baseUrl,
      partnerId,
      failedKey,
      partnerPayload()
    );
    assert.equal(recoveredFailure.status, 422, 'Failed request state survives backend restart');
    assert.equal(restartedFailureCalls, 0, 'Restart recovery does not repeat failed financial processing');
  } finally {
    await close(failureRestart.server);
  }

  const rollbackKey = `partner-rollback-${namespace}`;
  let rollbackProcessorCalls = 0;
  const rollbackDatabase = {
    partnerIdempotency: prisma.partnerIdempotency,
    $transaction(callback) {
      return prisma.$transaction(tx => callback({
        partnerIdempotency: {
          findUnique: args => tx.partnerIdempotency.findUnique(args),
          create: args => tx.partnerIdempotency.create(args),
          update: async () => {
            throw new Error('synthetic final-response persistence failure');
          },
        },
      }));
    },
  };
  const rollbackServer = await listen(makePartnerApp({
    async processPayment() {
      rollbackProcessorCalls += 1;
      return {
        success: true,
        executionMode: 'SIMULATED',
        settlementVerified: false,
        uetr: randomBytes(16).toString('hex'),
      };
    },
  }, rollbackDatabase));
  try {
    const rolledBack = await signedPartnerRequest(
      rollbackServer.baseUrl,
      partnerId,
      rollbackKey,
      partnerPayload()
    );
    assert.equal(rolledBack.status, 500, 'Failure while persisting the final response fails the request');
    assert.equal(
      await prisma.partnerIdempotency.count({
        where: { partnerId, idempotencyKey: rollbackKey },
      }),
      0,
      'A partial idempotency transaction rolls back its PROCESSING record'
    );
    assert.equal(rollbackProcessorCalls, 1, 'The simulated operation reached the transaction before the injected rollback');
  } finally {
    await close(rollbackServer.server);
  }

  let retryCalls = 0;
  const recoveredRollback = await listen(makePartnerApp({
    async processPayment() {
      retryCalls += 1;
      return {
        success: true,
        executionMode: 'SIMULATED',
        settlementVerified: false,
        uetr: randomBytes(16).toString('hex'),
      };
    },
  }));
  try {
    const retry = await signedPartnerRequest(
      recoveredRollback.baseUrl,
      partnerId,
      rollbackKey,
      partnerPayload()
    );
    assert.equal(retry.status, 200, 'A rolled-back idempotency key can safely be retried');
    assert.equal(retryCalls, 1, 'Retry executes once after the prior database transaction rolled back');
  } finally {
    await close(recoveredRollback.server);
  }
}

async function main() {
  await prisma.$connect();
  try {
    await testEncryptionAndKycRoutes();
    await testReviewerIdentityAndAudit();
    await testPartnerIdempotencyAndRecovery();
    console.log('Security PostgreSQL checks passed: KYC envelope encryption/rotation/legacy migration, staff identity and append-only review audit, plus multi-instance durable partner idempotency and restart recovery.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(error => {
  console.error('Security PostgreSQL checks failed:', error);
  process.exitCode = 1;
});
