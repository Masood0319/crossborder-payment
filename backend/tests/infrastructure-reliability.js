import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import { startBackend } from '../src/index.js';
import { verifyPrismaConnection } from '../src/gateway/database.js';
import { createServer, validateBackendEnvironment } from '../src/gateway/server.js';
import { createConsumerRouter } from '../src/gateway/consumer-routes.js';
import { createTreasuryRouter } from '../src/gateway/treasury-routes.js';
import { buildTransferLifecycle, getTransferStatusPresentation, transitionTransfer } from '../src/gateway/transfer-lifecycle.js';
import { PaymentRoutingEngine } from '../src/routing/routing-engine.js';

const validEnvironment = {
  DATABASE_URL: 'postgresql://test:test@localhost:5432/crossborder_test?sslmode=disable',
  HMAC_SECRET: 'test-hmac-secret-value-with-at-least-32-characters',
  BANK_CALLBACK_HMAC_SECRET: 'test-callback-secret-with-at-least-32-characters',
  JWT_SECRET: 'test-jwt-secret-value-with-at-least-32-characters',
  LEDGER_ADMIN_KEY: 'test-ledger-admin-key-with-at-least-32-characters',
  PORT: '0',
  HOST: '127.0.0.1',
};
process.env.HMAC_SECRET = validEnvironment.HMAC_SECRET;
process.env.JWT_SECRET = validEnvironment.JWT_SECRET;

test('database verification connects and executes a read-only query', async () => {
  const calls = [];
  const prisma = {
    async $connect() { calls.push('connect'); },
    async $queryRaw(strings) {
      calls.push(strings.join('?'));
      return [{ connection_test: 1 }];
    },
  };

  assert.deepEqual(await verifyPrismaConnection(prisma), [{ connection_test: 1 }]);
  assert.deepEqual(calls, ['connect', 'SELECT 1 AS connection_test']);
});

test('database verification reports connection and query failures', async () => {
  await assert.rejects(
    verifyPrismaConnection({
      async $connect() { throw Object.assign(new Error('unavailable'), { code: 'P1001' }); },
      async $queryRaw() { assert.fail('query should not run after connect failure'); },
    }),
    error => error.code === 'P1001'
  );

  await assert.rejects(
    verifyPrismaConnection({
      async $connect() {},
      async $queryRaw() { throw Object.assign(new Error('query failed'), { code: 'P1002' }); },
    }),
    error => error.code === 'P1002'
  );
});

test('database verification enforces a bounded connection timeout', async () => {
  await assert.rejects(
    verifyPrismaConnection({
      async $connect() { return new Promise(() => {}); },
      async $queryRaw() { assert.fail('query should not run after connection timeout'); },
    }, 10),
    error => error.code === 'ETIMEDOUT'
  );
  await assert.rejects(
    verifyPrismaConnection({
      async $connect() {},
      async $queryRaw() { return new Promise(() => {}); },
    }, 10),
    error => error.code === 'ETIMEDOUT'
  );
});

test('startup validation rejects missing and unsafe database configuration', () => {
  const missingDatabaseUrl = { ...validEnvironment };
  delete missingDatabaseUrl.DATABASE_URL;
  assert.throws(
    () => validateBackendEnvironment(missingDatabaseUrl),
    /DATABASE_URL must be configured/
  );
  assert.throws(
    () => validateBackendEnvironment({ ...validEnvironment, HMAC_SECRET: 'short' }),
    /HMAC_SECRET must be configured/
  );
  assert.throws(
    () => validateBackendEnvironment({
      ...validEnvironment,
      DATABASE_URL: 'postgresql://test:test@db.example.test/app',
    }),
    /must use sslmode/
  );
  assert.throws(
    () => validateBackendEnvironment({
      ...validEnvironment,
      DATABASE_URL: 'invalid-url',
    }),
    /valid PostgreSQL URL/
  );
  assert.throws(
    () => validateBackendEnvironment({
      ...validEnvironment,
      JWT_SECRET: 'REPLACE_WITH_ANOTHER_RANDOM_SECRET_AT_LEAST_32_CHARACTERS',
    }),
    /JWT_SECRET must be configured/
  );
});

test('customer login, session, logout and cookie CSRF protection use HttpOnly sessions', async () => {
  const user = {
    id: 'c0ffee00-0000-4000-8000-000000000081',
    fullName: 'Cookie User',
    email: 'cookie@example.invalid',
    phone: '+923001234567',
    kycStatus: 'APPROVED',
    passwordHash: await bcrypt.hash('SecurePassword1!', 4),
  };
  const app = express();
  app.use(express.json());
  app.use('/api/v1', createConsumerRouter({
    prisma: {
      user: {
        async findUnique({ where }) {
          return where.email === user.email ? user : (where.id === user.id ? user : null);
        },
      },
    },
    orchestrator: {},
  }));
  const server = await new Promise(resolve => {
    const listeningServer = app.listen(0, '127.0.0.1', () => resolve(listeningServer));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}/api/v1`;
  try {
    const loginResponse = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email, password: 'SecurePassword1!' }),
    });
    assert.equal(loginResponse.status, 200);
    const setCookie = loginResponse.headers.get('set-cookie');
    assert.match(setCookie, /crossborder_customer_session=/);
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Strict/);
    const cookie = setCookie.split(';')[0];
    assert.equal(Object.hasOwn(await loginResponse.json(), 'token'), false);

    const sessionResponse = await fetch(`${baseUrl}/auth/session`, { headers: { Cookie: cookie } });
    assert.equal(sessionResponse.status, 200);
    assert.equal((await sessionResponse.json()).user.id, user.id);

    const csrfResponse = await fetch(`${baseUrl}/beneficiaries`, {
      method: 'POST',
      headers: { Cookie: cookie, Origin: 'https://attacker.example', 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(csrfResponse.status, 403);

    const logoutResponse = await fetch(`${baseUrl}/auth/logout`, {
      method: 'POST',
      headers: { Cookie: cookie, Origin: 'http://localhost:3001' },
    });
    assert.equal(logoutResponse.status, 200);
    assert.match(logoutResponse.headers.get('set-cookie'), /Max-Age=0/);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test('backend starts only after database initialization, exposes independent liveness/readiness, and shuts down cleanly', async () => {
  let databaseAvailable = true;
  let disconnectCount = 0;
  const prisma = {
    async $connect() {},
    async $queryRaw() {
      if (!databaseAvailable) throw Object.assign(new Error('database unavailable'), { code: 'P1001' });
      return [{ connection_test: 1 }];
    },
    async $disconnect() { disconnectCount += 1; },
  };
  const { app } = createServer({ prisma });

  const runtime = await startBackend({
    environment: validEnvironment,
    serverFactory: () => ({ app, prisma }),
  });
  try {
    const baseUrl = `http://127.0.0.1:${runtime.server.address().port}`;
    assert.equal((await fetch(`${baseUrl}/health/live`)).status, 200);
    assert.equal((await fetch(`${baseUrl}/health/ready`)).status, 200);
    await assert.rejects(
      startBackend({ environment: validEnvironment, serverFactory: () => ({ app, prisma }) }),
      /already been started/
    );

    databaseAvailable = false;
    assert.equal((await fetch(`${baseUrl}/health/live`)).status, 200);
    const notReady = await fetch(`${baseUrl}/health/ready`);
    assert.equal(notReady.status, 503);
    const readinessBody = await notReady.json();
    assert.equal(readinessBody.status, 'not_ready');
    assert.equal(readinessBody.dependencies.database, 'unavailable');
  } finally {
    await runtime.shutdown();
  }
  assert.equal(disconnectCount, 1);
});

test('backend does not listen when PostgreSQL initialization fails', async () => {
  let disconnectCount = 0;
  await assert.rejects(
    startBackend({
      environment: validEnvironment,
      serverFactory: () => ({
        app: express(),
        prisma: {
          async $connect() { throw Object.assign(new Error('unavailable'), { code: 'P1001' }); },
          async $disconnect() { disconnectCount += 1; },
        },
      }),
    }),
    error => error.code === 'P1001'
  );
  assert.equal(disconnectCount, 1);
});

test('authenticated transfer history is scoped, paginated, filtered, and omits full beneficiary bank data', async () => {
  const userId = 'c0ffee00-0000-4000-8000-000000000001';
  let observedWhere;
  const prisma = {
    transfer: {
      async findMany(args) {
        observedWhere = args.where;
        assert.equal(args.skip, 10);
        assert.equal(args.take, 10);
        assert.deepEqual(args.orderBy, [{ createdAt: 'desc' }, { id: 'desc' }]);
        return [{
          id: 'c0ffee00-0000-4000-8000-000000000002',
          uetr: 'c0ffee00-0000-4000-8000-000000000003',
          sendAmount: '1000.00',
          feeAmount: '100.00',
          sourceCurrency: 'PKR',
          payoutAmount: '12.34',
          payoutCurrency: 'AED',
          exchangeRate: '0.012340',
          status: 'SIMULATED',
          purpose: 'FAMILY_SUPPORT',
          createdAt: new Date('2026-01-01T00:00:00Z'),
          beneficiary: { fullName: 'Test Recipient', bankName: 'Example Bank', country: 'AE' },
        }];
      },
      async count({ where }) {
        assert.equal(where.userId, userId);
        return 21;
      },
      async groupBy({ by }) {
        return by[0] === 'status'
          ? [{ status: 'SIMULATED', _count: { _all: 21 } }]
          : [{ sourceCurrency: 'PKR', _count: { _all: 21 }, _sum: { sendAmount: '21000.00', feeAmount: '2100.00' } }];
      },
    },
  };
  const app = express();
  app.use('/api/v1', createConsumerRouter({ prisma, orchestrator: {} }));
  const server = await new Promise(resolve => {
    const listeningServer = app.listen(0, '127.0.0.1', () => resolve(listeningServer));
  });
  const token = jwt.sign({}, validEnvironment.JWT_SECRET, {
    subject: userId,
    expiresIn: '1h',
    issuer: 'crossborder-payment-orchestrator',
    audience: 'consumer-app',
    algorithm: 'HS256',
  });

  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/transfers?page=2&pageSize=10&status=SIMULATED&query=Test&from=2026-01-01T00%3A00%3A00Z&to=2026-01-31T23%3A59%3A59Z`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.pagination.total, 21);
    assert.equal(body.pagination.totalPages, 3);
    assert.deepEqual(body.summary.byCurrency[0], {
      currency: 'PKR',
      count: 21,
      sendAmount: '21000.00',
      feeAmount: '2100.00',
    });
    assert.equal(body.transfers[0].beneficiary.fullName, 'Test Recipient');
    assert.equal(Object.hasOwn(body.transfers[0].beneficiary, 'iban'), false);
    assert.deepEqual(observedWhere, {
      userId,
      status: 'SIMULATED',
      OR: [
        { beneficiary: { fullName: { contains: 'Test', mode: 'insensitive' } } },
      ],
      createdAt: {
        gte: new Date('2026-01-01T00:00:00Z'),
        lte: new Date('2026-01-31T23:59:59Z'),
      },
    });
    const exactReference = 'c0ffee00-0000-4000-8000-000000000003';
    const exactReferenceResponse = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/transfers?page=2&pageSize=10&query=${exactReference}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(exactReferenceResponse.status, 200);
    assert.deepEqual(observedWhere.OR, [
      { beneficiary: { fullName: { contains: exactReference, mode: 'insensitive' } } },
      { uetr: exactReference },
    ]);

    const invalidFilter = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/transfers?status=NOT_A_STATUS`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(invalidFilter.status, 400);
    const unauthorized = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/transfers`);
    assert.equal(unauthorized.status, 401);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test('customer transfer detail is owned, ordered, normalized, and retryable', async () => {
  const userId = 'c0ffee00-0000-4000-8000-000000000071';
  const transferId = 'c0ffee00-0000-4000-8000-000000000072';
  let observedWhere;
  const app = express();
  app.use('/api/v1', createConsumerRouter({
    prisma: {
      transfer: {
        async findFirst({ where }) {
          observedWhere = where;
          if (where.id !== transferId) return null;
          return {
            id: transferId,
            uetr: 'c0ffee00-0000-4000-8000-000000000073',
            status: 'FAILED',
            sendAmount: '1000.00',
            feeAmount: '100.00',
            sourceCurrency: 'PKR',
            payoutAmount: '12.34',
            payoutCurrency: 'AED',
            exchangeRate: '0.012340',
            purpose: 'FAMILY_SUPPORT',
            createdAt: new Date('2026-01-01T00:00:00Z'),
            timeline: [{ step: 'ROUTE_SELECTED', label: 'Simulated route selected', status: 'ESTIMATED', completedAt: '2026-01-01T00:00:01Z', routingDecision: { strategy: 'BALANCED', selectedRoute: { providerAdapter: { id: 'SIM_STANDARD' } } } }],
            statusEvents: [{ id: 'event-1', sequenceOrder: 1, fromStatus: 'SUBMITTED', toStatus: 'FAILED', reason: 'Simulated provider declined the instruction', actorType: 'SYSTEM', createdAt: new Date('2026-01-01T00:00:02Z') }],
            beneficiary: { fullName: 'Test Recipient', bankName: 'Example Bank', country: 'AE', iban: 'AE070331234567890123456' },
          };
        },
      },
    },
    orchestrator: {},
  }));
  const server = await new Promise(resolve => {
    const listeningServer = app.listen(0, '127.0.0.1', () => resolve(listeningServer));
  });
  const token = jwt.sign({}, validEnvironment.JWT_SECRET, {
    subject: userId,
    expiresIn: '1h',
    issuer: 'crossborder-payment-orchestrator',
    audience: 'consumer-app',
  });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/transfers/${transferId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(observedWhere, { id: transferId, userId });
    assert.equal(body.lifecycle.currentStatus, 'FAILED');
    assert.equal(body.lifecycle.presentation.action, 'INTERVENTION');
    assert.deepEqual(body.lifecycle.timeline.map(event => event.eventType), ['ROUTE_SELECTED', 'STATUS_TRANSITION']);

    const missing = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/transfers/c0ffee00-0000-4000-8000-000000000079`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(missing.status, 404);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test('beneficiary edits validate bank formats and preserve used transfer records', async () => {
  const userId = 'c0ffee00-0000-4000-8000-000000000011';
  const beneficiaryId = 'c0ffee00-0000-4000-8000-000000000012';
  let isUsed = false;
  let deleteCount = 0;
  const beneficiary = {
    id: beneficiaryId,
    userId,
    fullName: 'Old Name',
    iban: 'AE070331234567890123456',
    bic: 'FABAEADU',
    bankName: 'Example Bank',
    country: 'AE',
    verificationStatus: 'FORMAT_VALIDATED',
  };
  const prisma = {
    async $transaction(callback) { return callback(prisma); },
    beneficiary: {
      async findFirst({ where }) {
        return where.id === beneficiaryId && where.userId === userId ? beneficiary : null;
      },
      async update({ data }) {
        Object.assign(beneficiary, data);
        return beneficiary;
      },
      async delete() {
        deleteCount += 1;
      },
    },
    transfer: {
      async findFirst() { return isUsed ? { id: 'transfer-used' } : null; },
    },
  };
  const app = express();
  app.use(express.json());
  app.use('/api/v1', createConsumerRouter({ prisma, orchestrator: {} }));
  const server = await new Promise(resolve => {
    const listeningServer = app.listen(0, '127.0.0.1', () => resolve(listeningServer));
  });
  const token = jwt.sign({}, validEnvironment.JWT_SECRET, {
    subject: userId,
    expiresIn: '1h',
    issuer: 'crossborder-payment-orchestrator',
    audience: 'consumer-app',
    algorithm: 'HS256',
  });
  const url = `http://127.0.0.1:${server.address().port}/api/v1/beneficiaries/${beneficiaryId}`;
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  try {
    const updated = await fetch(url, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        fullName: 'Updated Recipient',
        iban: 'ae07 0331 2345 6789 0123 456',
        bic: 'fabaeadu',
        bankName: 'Updated Bank',
        country: 'AE',
      }),
    });
    assert.equal(updated.status, 200);
    const updatedBody = await updated.json();
    assert.equal(updatedBody.beneficiary.fullName, 'Updated Recipient');
    assert.equal(updatedBody.beneficiary.iban, 'AE070331234567890123456');
    assert.equal(updatedBody.beneficiary.verificationStatus, 'FORMAT_VALIDATED');

    isUsed = true;
    const blockedUpdate = await fetch(url, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        fullName: 'Changed After Transfer',
        iban: 'AE070331234567890123456',
        bic: 'FABAEADU',
        bankName: 'Example Bank',
        country: 'AE',
      }),
    });
    assert.equal(blockedUpdate.status, 409);

    const blockedDelete = await fetch(url, { method: 'DELETE', headers });
    assert.equal(blockedDelete.status, 409);
    assert.equal(deleteCount, 0);

    isUsed = false;
    const removed = await fetch(url, { method: 'DELETE', headers });
    assert.equal(removed.status, 204);
    assert.equal(deleteCount, 1);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test('treasury operations APIs enforce staff roles, filter safely, audit access, and expose investigation events', async () => {
  const transferId = 'c0ffee00-0000-4000-8000-000000000022';
  const transfer = {
    id: transferId,
    uetr: 'c0ffee00-0000-4000-8000-000000000023',
    corridorCode: 'PK_AE',
    sourceCurrency: 'PKR',
    sendAmount: '1000.0000',
    feeAmount: '100.0000',
    payoutCurrency: 'AED',
    payoutAmount: '12.3400',
    exchangeRate: '0.012340',
    status: 'FAILED',
    purpose: 'FAMILY_SUPPORT',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    beneficiary: { fullName: 'Recipient Example', country: 'AE' },
    user: { kycStatus: 'APPROVED' },
    statusEvents: [{
      id: 'event-1',
      sequenceOrder: 6,
      fromStatus: 'SUBMITTED',
      toStatus: 'FAILED',
      reason: 'Simulated provider declined the instruction',
      actorType: 'SYSTEM',
      createdAt: new Date('2026-01-01T00:01:00Z'),
    }],
    transaction: {
      reference: 'PAY-OPS-001',
      status: 'FAILED',
      reversalReason: null,
      reversedAt: null,
      isoAuditLogs: [{ messageId: 'message-1', messageType: 'pacs.008', status: 'RJCT', createdAt: new Date('2026-01-01T00:01:00Z') }],
      callbackInbox: [{ source: 'SIMULATED', messageId: 'callback-1', transactionStatus: 'RJCT', processingStatus: 'IGNORED_SIMULATED', processingError: null, receivedAt: new Date('2026-01-01T00:01:00Z') }],
    },
  };
  let observedWhere;
  const auditEvents = [];
  const prisma = {
    transfer: {
      async count({ where } = {}) {
        if (where?.status === 'SIMULATED') return 4;
        if (where?.status?.in?.includes('FAILED')) return 1;
        if (where?.status?.in) return 2;
        return 9;
      },
      async groupBy({ by }) {
        return by[0] === 'corridorCode'
          ? [{ corridorCode: 'PK_AE', _count: { _all: 9 }, _sum: { sendAmount: '9000.00', feeAmount: '900.00' } }]
          : [{ sourceCurrency: 'PKR', _count: { _all: 9 }, _sum: { sendAmount: '9000.00', feeAmount: '900.00' } }];
      },
      async findMany(args) {
        observedWhere = args.where;
        return [{ ...transfer, beneficiary: undefined, transaction: undefined }];
      },
      async findUnique({ where }) { return where.id === transferId ? transfer : null; },
    },
    transferStatusEvent: {
      async findMany() {
        return [{ id: 'event-1', fromStatus: 'SUBMITTED', toStatus: 'FAILED', reason: 'Provider decline', actorType: 'SYSTEM', createdAt: new Date(), transfer: { uetr: transfer.uetr, corridorCode: 'PK_AE' } }];
      },
    },
    user: { async count() { return 3; } },
    fxQuote: {
      async count() { return 2; },
      async findMany() { return [{ quoteId: 'quote-1', rateProvider: 'STATIC_DEMO', expiresAt: new Date(Date.now() + 30000) }]; },
    },
    corridor: { async findUnique() { return { sourceRail: 'SIMULATED', destinationRail: 'SIMULATED', isActive: true }; } },
    treasuryAuditEvent: {
      async create({ data }) {
        const event = { id: `audit-${auditEvents.length + 1}`, createdAt: new Date(), ...data };
        auditEvents.push(event);
        return event;
      },
      async findMany() { return auditEvents; },
    },
  };
  const app = express();
  app.use('/api/treasury', createTreasuryRouter({
    prisma,
    staffTokenVerifier: token => ({
      reviewerId: `staff-${token}`,
      issuer: 'test-issuer',
      roles: token === 'viewer' ? ['TREASURY_VIEWER'] : ['KYC_REVIEWER'],
    }),
  }));
  const server = await new Promise(resolve => {
    const listeningServer = app.listen(0, '127.0.0.1', () => resolve(listeningServer));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}/api/treasury`;
  const viewerHeaders = { Authorization: 'Bearer viewer' };

  try {
    const unauthorized = await fetch(`${baseUrl}/operations/summary`);
    assert.equal(unauthorized.status, 401);
    const wrongRole = await fetch(`${baseUrl}/operations/summary`, { headers: { Authorization: 'Bearer kyc' } });
    assert.equal(wrongRole.status, 403);

    const summaryResponse = await fetch(`${baseUrl}/operations/summary`, { headers: viewerHeaders });
    assert.equal(summaryResponse.status, 200);
    const summary = await summaryResponse.json();
    assert.equal(summary.executionMode, 'SIMULATED');
    assert.deepEqual(summary.totals, {
      totalTransfers: 9,
      successfulSimulatedTransfers: 4,
      pendingTransfers: 2,
      failedTransfers: 1,
      pendingKycApplications: 3,
      availableFxQuotes: 2,
    });
    assert.equal(summary.currencyStatistics[0].sendAmount, '9000.00');
    assert.equal(auditEvents.some(event => event.subjectType === 'OPERATIONS_SUMMARY'), true);

    const listResponse = await fetch(`${baseUrl}/operations/transfers?status=FAILED&currency=PKR&corridor=PK_AE&query=PAY-OPS-001`, { headers: viewerHeaders });
    assert.equal(listResponse.status, 200);
    const list = await listResponse.json();
    assert.equal(list.transfers[0].user.kycStatus, 'APPROVED');
    assert.equal(Object.hasOwn(list.transfers[0], 'beneficiary'), false);
    assert.deepEqual(observedWhere, {
      status: 'FAILED',
      corridorCode: 'PK_AE',
      AND: [
        { OR: [{ sourceCurrency: 'PKR' }, { payoutCurrency: 'PKR' }] },
        { OR: [{ transaction: { is: { reference: { contains: 'PAY-OPS-001', mode: 'insensitive' } } } }] },
      ],
    });
    const invalidFilter = await fetch(`${baseUrl}/operations/transfers?status=INVALID`, { headers: viewerHeaders });
    assert.equal(invalidFilter.status, 400);

    const detailResponse = await fetch(`${baseUrl}/operations/transfers/${transferId}`, { headers: viewerHeaders });
    assert.equal(detailResponse.status, 200);
    const detail = await detailResponse.json();
    assert.match(detail.transfer.statusEvents[0].reason, /declined/);
    assert.equal(detail.transfer.transaction.isoAuditLogs.length, 1);
    assert.equal(detail.transfer.transaction.callbackInbox.length, 1);
    assert.equal(Object.hasOwn(detail.transfer.beneficiary, 'iban'), false);
    assert.equal(detail.routing.executionMode, 'SIMULATED');
    assert.equal(auditEvents.some(event => event.subjectId === transferId), true);

    const quotesResponse = await fetch(`${baseUrl}/fx/quotes`, { headers: viewerHeaders });
    assert.equal(quotesResponse.status, 200);
    assert.equal((await quotesResponse.json()).quotes[0].rateProvider, 'STATIC_DEMO');
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test('KYC document access creates allowed and denied audit metadata without document contents', async () => {
  const userId = 'c0ffee00-0000-4000-8000-000000000082';
  const documentId = 'c0ffee00-0000-4000-8000-000000000083';
  const auditEvents = [];
  const app = express();
  app.use((req, _res, next) => { req.correlationId = req.headers['x-correlation-id'] || 'test-correlation'; next(); });
  app.use('/api/v1', createConsumerRouter({
    prisma: {
      kycDocument: {
        async findFirst({ where }) {
          if (where.id !== documentId) return null;
          return {
            id: documentId,
            documentType: 'CNIC',
            fileName: 'identity.bin',
            mimeType: 'application/octet-stream',
            fileData: null,
            ciphertext: Buffer.from('ciphertext'),
            encryptionNonce: Buffer.from('nonce'),
            authenticationTag: Buffer.from('tag'),
            keyVersion: 'v1',
            wrappedDataKey: Buffer.from('wrapped'),
            keyWrapNonce: Buffer.from('wrapnonce'),
            keyWrapTag: Buffer.from('wraptag'),
            encryptionAlgorithm: 'AES-256-GCM',
            createdAt: new Date(),
          };
        },
      },
      treasuryAuditEvent: {
        async create({ data }) {
          auditEvents.push(data);
          return data;
        },
      },
    },
    orchestrator: {},
    kycEncryption: { decrypt() { return Buffer.from('SENSITIVE_DOCUMENT_NOT_EXPECTED_IN_AUDIT'); } },
    staffTokenVerifier: token => ({
      reviewerId: 'staff-reviewer-1',
      issuer: 'test-issuer',
      roles: token === 'reviewer' ? ['KYC_REVIEWER'] : ['TREASURY_VIEWER'],
    }),
  }));
  const server = await new Promise(resolve => {
    const listeningServer = app.listen(0, '127.0.0.1', () => resolve(listeningServer));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}/api/v1/admin/kyc`;
  try {
    const denied = await fetch(`${baseUrl}/${userId}/documents/${documentId}`, {
      headers: { Authorization: 'Bearer wrong-role' },
    });
    assert.equal(denied.status, 403);
    const allowed = await fetch(`${baseUrl}/${userId}/documents/${documentId}`, {
      headers: { Authorization: 'Bearer reviewer', 'X-Correlation-ID': 'phase5-test-correlation' },
    });
    assert.equal(allowed.status, 200);
    assert.ok(auditEvents.some(event => event.details?.outcome === 'DENIED'));
    assert.ok(auditEvents.some(event => event.details?.outcome === 'ALLOWED'
      && event.details.action === 'DOWNLOAD'
      && event.details.requestCorrelationId === 'phase5-test-correlation'));
    assert.equal(JSON.stringify(auditEvents).includes('SENSITIVE_DOCUMENT_NOT_EXPECTED_IN_AUDIT'), false);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test('KYC queue and review history are restricted to KYC staff roles', async () => {
  const userId = 'c0ffee00-0000-4000-8000-000000000031';
  const app = express();
  app.use('/api/v1', createConsumerRouter({
    prisma: {
      user: {
        async findMany() {
          return [{ id: userId, fullName: 'Applicant', email: 'applicant@example.invalid', updatedAt: new Date(), kycDocuments: [] }];
        },
      },
      kycReviewEvent: {
        async findMany() {
          return [{ id: 'review-1', userId, reviewerId: 'reviewer-1', reviewerIssuer: 'test-issuer', action: 'REVIEW', previousStatus: 'PENDING', decision: 'REJECTED', reason: 'Please resubmit a clearer document' }];
        },
      },
    },
    orchestrator: {},
    staffTokenVerifier: token => ({
      reviewerId: `staff-${token}`,
      issuer: 'test-issuer',
      roles: token === 'reviewer' ? ['KYC_REVIEWER'] : ['TREASURY_VIEWER'],
    }),
  }));
  const server = await new Promise(resolve => {
    const listeningServer = app.listen(0, '127.0.0.1', () => resolve(listeningServer));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}/api/v1/admin/kyc`;

  try {
    const denied = await fetch(baseUrl, { headers: { Authorization: 'Bearer treasury' } });
    assert.equal(denied.status, 403);
    const queueResponse = await fetch(baseUrl, { headers: { Authorization: 'Bearer reviewer' } });
    assert.equal(queueResponse.status, 200);
    assert.equal((await queueResponse.json()).applicants[0].id, userId);
    const historyResponse = await fetch(`${baseUrl}/${userId}/reviews`, { headers: { Authorization: 'Bearer reviewer' } });
    assert.equal(historyResponse.status, 200);
    const history = await historyResponse.json();
    assert.equal(history.reviews[0].reviewerId, 'reviewer-1');
    assert.match(history.reviews[0].reason, /clearer document/);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test('routing analytics is treasury-only and reports persisted simulated decisions with scan limits', async () => {
  const auditEvents = [];
  let observedQuery;
  const decision = {
    strategy: 'BALANCED',
    selectedRoute: {
      routeId: 'PK_AE:SIM_ECONOMY',
      providerAdapter: { id: 'SIM_ECONOMY', label: 'Simulated Economy Rail', mode: 'SIMULATED' },
      estimatedFee: '115.00',
      feeCurrency: 'PKR',
      estimatedProcessingMinutes: 240,
      riskScore: 20,
      score: '80.0000',
    },
    alternatives: [],
    rejectedRoutes: [{
      providerAdapter: { id: 'SIM_FAST' },
      rejectionReasons: ['Insufficient simulated liquidity for amount plus estimated provider fee'],
    }],
    decisionReason: 'Simulated route selected for test coverage.',
  };
  const app = express();
  app.use('/api/treasury', createTreasuryRouter({
    prisma: {
      transfer: {
        async findMany(query) {
          observedQuery = query;
          return [{
            id: 'c0ffee00-0000-4000-8000-000000000061',
            uetr: 'c0ffee00-0000-4000-8000-000000000062',
            corridorCode: 'PK_AE',
            status: 'SIMULATED',
            createdAt: new Date('2026-01-01T00:00:00Z'),
            timeline: [{ step: 'ROUTE_SELECTED', routingDecision: decision }],
          }];
        },
      },
      treasuryAuditEvent: {
        async create({ data }) {
          auditEvents.push(data);
          return data;
        },
      },
    },
    staffTokenVerifier: token => ({
      reviewerId: `staff-${token}`,
      issuer: 'test-issuer',
      roles: token === 'viewer' ? ['TREASURY_VIEWER'] : ['KYC_REVIEWER'],
    }),
  }));
  const server = await new Promise(resolve => {
    const listeningServer = app.listen(0, '127.0.0.1', () => resolve(listeningServer));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}/api/treasury/routing/analytics`;

  try {
    const denied = await fetch(baseUrl, { headers: { Authorization: 'Bearer reviewer' } });
    assert.equal(denied.status, 403);
    const response = await fetch(baseUrl, { headers: { Authorization: 'Bearer viewer' } });
    assert.equal(response.status, 200);
    const analytics = await response.json();
    assert.equal(analytics.executionMode, 'SIMULATED');
    assert.equal(analytics.sampleSize, 1);
    assert.equal(analytics.maximumRecordsScanned, 1000);
    assert.equal(analytics.providers.length, 3);
    assert.deepEqual(analytics.providerSelections, [{ providerId: 'SIM_ECONOMY', count: 1 }]);
    assert.deepEqual(analytics.corridorPerformance, [{
      corridorCode: 'PK_AE',
      count: 1,
      selectedProviders: { SIM_ECONOMY: 1 },
    }]);
    assert.equal(analytics.routeRejections[0].providerId, 'SIM_FAST');
    assert.equal(analytics.recentDecisions[0].selectedRoute.estimatedFee, '115.00');
    assert.equal(observedQuery.take, 1000);
    assert.equal(auditEvents[0].subjectType, 'ROUTING_ANALYTICS');
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test('consumer routing preview requires authentication and routing lookup remains customer-scoped', async () => {
  const userId = 'c0ffee00-0000-4000-8000-000000000051';
  let observedOwnershipFilter;
  const app = express();
  app.use(express.json());
  app.use('/api/v1', createConsumerRouter({
    prisma: {
      transfer: {
        async findFirst({ where }) {
          observedOwnershipFilter = where;
          return null;
        },
      },
    },
    orchestrator: {},
  }));
  const server = await new Promise(resolve => {
    const listeningServer = app.listen(0, '127.0.0.1', () => resolve(listeningServer));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}/api/v1`;
  const token = jwt.sign({}, validEnvironment.JWT_SECRET, {
    subject: userId,
    expiresIn: '1h',
    issuer: 'crossborder-payment-orchestrator',
    audience: 'consumer-app',
    algorithm: 'HS256',
  });
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  try {
    const unauthorized = await fetch(`${baseUrl}/routing/strategies`);
    assert.equal(unauthorized.status, 401);
    const strategiesResponse = await fetch(`${baseUrl}/routing/strategies`, { headers });
    assert.equal(strategiesResponse.status, 200);
    assert.deepEqual((await strategiesResponse.json()).strategies.map(strategy => strategy.id), ['LOWEST_COST', 'FASTEST', 'BALANCED']);
    const previewResponse = await fetch(`${baseUrl}/routing/preview`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        sourceCountry: 'PK',
        destinationCountry: 'AE',
        sourceCurrency: 'PKR',
        destinationCurrency: 'AED',
        amount: '10000.00',
        strategy: 'LOWEST_COST',
      }),
    });
    assert.equal(previewResponse.status, 200);
    const preview = await previewResponse.json();
    assert.equal(preview.selectedRoute.providerAdapter.id, 'SIM_ECONOMY');
    assert.equal(preview.rateSource, 'STATIC_DEMO');
    assert.equal(preview.estimatedOnly, true);

    const invalidPreview = await fetch(`${baseUrl}/routing/preview`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        sourceCountry: 'PK',
        destinationCountry: 'AE',
        sourceCurrency: 'USD',
        destinationCurrency: 'AED',
        amount: '10000.00',
      }),
    });
    assert.equal(invalidPreview.status, 400);
    const transferId = 'c0ffee00-0000-4000-8000-000000000052';
    const decisionResponse = await fetch(`${baseUrl}/transfers/${transferId}/routing`, { headers });
    assert.equal(decisionResponse.status, 404);
    assert.deepEqual(observedOwnershipFilter, { id: transferId, userId });
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test('transfer lifecycle transitions require reasons and reject concurrent duplicate state changes', async () => {
  let status = 'SUBMITTED';
  const events = [];
  const tx = {
    transfer: {
      async updateMany({ where, data }) {
        if (where.status !== status) return { count: 0 };
        status = data.status;
        return { count: 1 };
      },
    },
    transferStatusEvent: {
      async aggregate() { return { _max: { sequenceOrder: events.length || null } }; },
      async create({ data }) { events.push(data); return data; },
    },
  };

  await assert.rejects(
    transitionTransfer(tx, 'transfer-1', 'SUBMITTED', 'FAILED', ''),
    /transition reason/
  );
  assert.equal(status, 'SUBMITTED');
  const event = await transitionTransfer(tx, 'transfer-1', 'SUBMITTED', 'FAILED', 'Provider rejected the simulated instruction');
  assert.equal(status, 'FAILED');
  assert.equal(event.reason, 'Provider rejected the simulated instruction');
  assert.equal(events.length, 1);
  await assert.rejects(
    transitionTransfer(tx, 'transfer-1', 'SUBMITTED', 'FAILED', 'Duplicate state operation'),
    /changed concurrently/
  );
  await assert.rejects(
    transitionTransfer(tx, 'transfer-1', 'FAILED', 'SIMULATED', ''),
    /Invalid transfer status transition/
  );
  assert.equal(events.length, 1);
});

test('duplicate lifecycle transitions are idempotent and normalized timelines are safe and ordered', async () => {
  const existingEvent = {
    id: 'event-1',
    sequenceOrder: 1,
    fromStatus: 'SUBMITTED',
    toStatus: 'FAILED',
    reason: 'Provider rejected the simulated instruction',
    actorType: 'PROVIDER',
  };
  let findFirstCalls = 0;
  const tx = {
    transfer: {
      async updateMany() { return { count: 0 }; },
      async findUnique() { return { status: 'FAILED' }; },
    },
    transferStatusEvent: {
      async findFirst() { findFirstCalls += 1; return existingEvent; },
    },
  };
  assert.equal(await transitionTransfer(
    tx,
    'transfer-1',
    'SUBMITTED',
    'FAILED',
    'Provider rejected the simulated instruction',
    'PROVIDER'
  ), existingEvent);
  assert.equal(findFirstCalls, 1);

  const lifecycle = buildTransferLifecycle({
    uetr: 'c0ffee00-0000-4000-8000-000000000070',
    status: 'FAILED',
    timeline: [{ step: 'ROUTE_SELECTED', label: 'Route selected', completedAt: '2026-01-01T00:00:01Z', status: 'ESTIMATED', routingDecision: { strategy: 'BALANCED', executionMode: 'SIMULATED', selectedRoute: { providerAdapter: { id: 'SIM_STANDARD' } } } }],
    statusEvents: [
      { ...existingEvent, createdAt: new Date('2026-01-01T00:00:02Z') },
    ],
  });
  assert.equal(lifecycle.terminal, true);
  assert.equal(lifecycle.timeline.length, 2);
  assert.deepEqual(lifecycle.timeline.map(event => event.eventType), ['ROUTE_SELECTED', 'STATUS_TRANSITION']);
  assert.equal(lifecycle.timeline[1].correlationId, 'c0ffee00-0000-4000-8000-000000000070');
  assert.equal(lifecycle.timeline[1].description, 'Provider rejected the simulated instruction');
  assert.equal(getTransferStatusPresentation('FAILED').action, 'INTERVENTION');
});

test('consumer transfer selects and persists an estimated route without changing the existing wallet posting', async () => {
  const userId = 'c0ffee00-0000-4000-8000-000000000041';
  const beneficiaryId = 'c0ffee00-0000-4000-8000-000000000042';
  const quoteId = 'c0ffee00-0000-4000-8000-000000000043';
  const user = {
    id: userId,
    fullName: 'Test Sender',
    kycStatus: 'APPROVED',
    pinHash: await bcrypt.hash('123456', 4),
  };
  const beneficiary = {
    id: beneficiaryId,
    userId,
    fullName: 'Test Recipient',
    iban: 'AE070331234567890123456',
    bic: 'FABAEADU',
    country: 'AE',
    verificationStatus: 'FORMAT_VALIDATED',
  };
  const persistedQuote = {
    quoteId,
    userId,
    corridorCode: 'PK_AE',
    sourceCurrency: 'PKR',
    targetCurrency: 'AED',
    instructedAmount: new Prisma.Decimal('1000.00'),
    settlementAmount: new Prisma.Decimal('12.34'),
    clientRate: new Prisma.Decimal('0.012340'),
    spreadRevenue: new Prisma.Decimal('0.01'),
    state: 'ACTIVE',
    expiresAt: new Date(Date.now() + 60000),
  };
  const wallet = {
    id: 'wallet-1',
    userId,
    currency: 'PKR',
    balance: new Prisma.Decimal('10000.00'),
    shadowAccountId: 'account-wallet',
  };
  const accounts = new Map([
    ['account-wallet', { id: 'account-wallet', accountNumber: 'WALLET-1', currency: 'PKR', type: 'LIABILITY', currentBalance: new Prisma.Decimal('10000.00') }],
  ]);
  let savedTransfer;
  let savedActivity;
  const prisma = {
    async $transaction(callback) { return callback(tx); },
    walletActivity: { async findUnique() { return savedActivity || null; } },
    user: { async findUnique() { return user; } },
    beneficiary: { async findFirst() { return beneficiary; } },
    fxQuote: {
      async findFirst() { return persistedQuote; },
      async updateMany({ data }) { persistedQuote.state = data.state; return { count: 1 }; },
    },
    transfer: {
      async findFirst() { return null; },
    },
  };
  const tx = {
    fxQuote: {
      async updateMany({ data }) { persistedQuote.state = data.state; return { count: 1 }; },
      async update({ data }) { Object.assign(persistedQuote, data); return persistedQuote; },
    },
    wallet: {
      async findUnique() { return wallet; },
      async updateMany({ data }) {
        wallet.balance = wallet.balance.minus(data.balance.decrement);
        return { count: 1 };
      },
    },
    account: {
      async findUniqueOrThrow({ where }) { return accounts.get(where.id); },
      async upsert({ where, create }) {
        let account = [...accounts.values()].find(item => item.accountNumber === where.accountNumber);
        if (!account) {
          account = {
            id: `account-${accounts.size}`,
            accountNumber: create.accountNumber,
            currency: create.currency,
            type: create.type,
            currentBalance: new Prisma.Decimal(create.currentBalance?.toString?.() || '0'),
          };
          accounts.set(account.id, account);
        }
        return account;
      },
      async updateMany({ where, data }) {
        const account = accounts.get(where.id);
        if (!account) return { count: 0 };
        if (data.currentBalance?.increment) account.currentBalance = account.currentBalance.plus(data.currentBalance.increment);
        if (data.currentBalance?.decrement) account.currentBalance = account.currentBalance.minus(data.currentBalance.decrement);
        return { count: 1 };
      },
    },
    transaction: {
      async create({ data }) { return { id: 'transaction-1', ...data }; },
    },
    entry: { async create() { return {}; } },
    transfer: {
      async create({ data }) {
        savedTransfer = { id: 'transfer-1', ...data };
        return savedTransfer;
      },
    },
    walletActivity: { async create({ data }) { savedActivity = data; return data; } },
  };
  const selectedRoutes = [];
  const routingEngine = {
    route(input) {
      selectedRoutes.push(input);
      return new PaymentRoutingEngine().route(input);
    },
  };
  const app = express();
  app.use(express.json());
  app.use('/api/v1', createConsumerRouter({
    prisma,
    routingEngine,
    orchestrator: {
      async processPayment(payload) {
        return {
          success: true,
          uetr: 'c0ffee00-0000-4000-8000-000000000044',
          pacs008Xml: '<pacs.008/>',
          pacs002Xml: '<pacs.002/>',
          settlementAmount: payload.instructedAmount,
        };
      },
    },
  }));
  const server = await new Promise(resolve => {
    const listeningServer = app.listen(0, '127.0.0.1', () => resolve(listeningServer));
  });
  const token = jwt.sign({}, validEnvironment.JWT_SECRET, {
    subject: userId,
    expiresIn: '1h',
    issuer: 'crossborder-payment-orchestrator',
    audience: 'consumer-app',
    algorithm: 'HS256',
  });

  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/transfers/send`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Idempotency-Key': 'route-integration-test',
      },
      body: JSON.stringify({
        amount: 1000,
        sourceCurrency: 'PKR',
        beneficiaryId,
        purpose: 'FAMILY_SUPPORT',
        pin: '123456',
        quoteId,
        routingStrategy: 'LOWEST_COST',
      }),
    });
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.equal(selectedRoutes.length, 1);
    assert.equal(selectedRoutes[0].strategy, 'LOWEST_COST');
    assert.equal(body.transfer.timeline.find(event => event.step === 'ROUTE_SELECTED').routingDecision.selectedRoute.providerAdapter.id, 'SIM_ECONOMY');
    assert.equal(body.routingDecision.selectedRoute.providerAdapter.id, 'SIM_ECONOMY');
    assert.equal(body.transfer.status, 'SIMULATED');
    assert.equal(wallet.balance.toString(), '8900');
    assert.equal(persistedQuote.state, 'CONSUMED');
    assert.equal(accounts.get('account-wallet').currentBalance.toString(), '8900');

    const replayResponse = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/transfers/send`, {
      method: 'POST',
      headers: {
        Authorization: ['Bearer ', token].join(''),
        'Content-Type': 'application/json',
        'X-Idempotency-Key': 'route-integration-test',
      },
      body: JSON.stringify({
        amount: 1000,
        sourceCurrency: 'PKR',
        beneficiaryId,
        purpose: 'FAMILY_SUPPORT',
        pin: '123456',
        quoteId,
        routingStrategy: 'LOWEST_COST',
      }),
    });
    assert.equal(replayResponse.status, 200);
    assert.equal((await replayResponse.json()).replay, true);
    assert.equal(selectedRoutes.length, 1);
    assert.equal(wallet.balance.toString(), '8900');
    assert.equal(accounts.get('account-wallet').currentBalance.toString(), '8900');
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
