import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { Prisma, PrismaClient } from '@prisma/client';
import { PaymentOrchestrator } from '../src/gateway/orchestrator.js';
import { createConsumerRouter } from '../src/gateway/consumer-routes.js';
import { handleBankCallback } from '../src/gateway/routes.js';
import { generateHmacSignature } from '../src/gateway/security.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('TEST_DATABASE_URL must point to a dedicated PostgreSQL test database');

const parsedUrl = new URL(databaseUrl);
const databaseName = parsedUrl.pathname.slice(1);
if (!['localhost', '127.0.0.1', '::1'].includes(parsedUrl.hostname)
  || !/(^|[_-])test([_-]|$)/i.test(databaseName)) {
  throw new Error('Refusing to run PostgreSQL integration tests: use a localhost database with "test" in its name');
}

process.env.DATABASE_URL = databaseUrl;
process.env.JWT_SECRET = 'test-only-jwt-secret-with-at-least-32-characters';
process.env.LEDGER_ADMIN_KEY = 'test-only-ledger-admin-key-with-at-least-32-characters';

const prisma = new PrismaClient();
const namespace = randomUUID().replaceAll('-', '').slice(0, 12);
const pin = '123456';
const jwtSecret = process.env.JWT_SECRET;
const callbackSecret = 'test-only-bank-callback-hmac-secret-32chars';

function assertBalanced(entries, label) {
  const debits = entries
    .filter(entry => entry.direction === 'DEBIT')
    .reduce((sum, entry) => sum.plus(entry.baseAmount), new Prisma.Decimal(0));
  const credits = entries
    .filter(entry => entry.direction === 'CREDIT')
    .reduce((sum, entry) => sum.plus(entry.baseAmount), new Prisma.Decimal(0));
  assert.equal(debits.toFixed(4), credits.toFixed(4), `${label} must balance exactly in USD`);
}

async function seedCustomer(label, initialBalance) {
  const user = await prisma.user.create({
    data: {
      fullName: `Postgres Test ${label}`,
      email: `pg-${namespace}-${label.toLowerCase()}@example.test`,
      phone: `+1555${namespace.slice(0, 8)}${label === 'A' ? '1' : '2'}`,
      passwordHash: 'not-used-by-this-test',
      pinHash: await bcrypt.hash(pin, 4),
      kycStatus: 'APPROVED',
    },
  });
  const account = await prisma.account.create({
    data: {
      accountNumber: `PGTEST-${namespace}-${label}`,
      name: `PostgreSQL test ${label} wallet`,
      type: 'LIABILITY',
      currency: 'PKR',
    },
  });
  const wallet = await prisma.wallet.create({
    data: {
      userId: user.id,
      currency: 'PKR',
      balance: initialBalance,
      shadowAccountId: account.id,
    },
  });
  const beneficiaries = {};
  for (const country of ['AE', 'SA']) {
    beneficiaries[country] = await prisma.beneficiary.create({
      data: {
        userId: user.id,
        fullName: `Test Beneficiary ${country}`,
        iban: country === 'AE' ? 'AE070331234567890123456' : 'SA3180123456789012345678',
        bic: country === 'AE' ? 'FABAEADU' : 'RJHIBSRI',
        bankName: `Test Bank ${country}`,
        country,
        verificationStatus: 'FORMAT_VALIDATED',
      },
    });
  }
  const token = jwt.sign({}, jwtSecret, {
    subject: user.id,
    expiresIn: '1h',
    issuer: 'crossborder-payment-orchestrator',
    audience: 'consumer-app',
    algorithm: 'HS256',
  });
  return { user, wallet, account, beneficiaries, token };
}

async function request(baseUrl, customer, method, path, body, headers = {}) {
  const response = await fetch(`${baseUrl}/api/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${customer.token}`,
      'Content-Type': 'application/json',
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

async function quote(baseUrl, customer, amount, country, key) {
  const result = await request(baseUrl, customer, 'POST', '/fx/quote', {
    amount,
    sourceCurrency: 'PKR',
    country,
  }, { 'X-Idempotency-Key': key });
  assert.equal(result.status, 200, `FX quote failed: ${JSON.stringify(result.body)}`);
  return result.body;
}

function transferBody(customer, beneficiary, amount, quoteId) {
  return {
    amount,
    sourceCurrency: 'PKR',
    beneficiaryId: beneficiary.id,
    purpose: 'FAMILY_SUPPORT',
    pin,
    quoteId,
  };
}

async function transfer(baseUrl, customer, beneficiary, amount, quoteId, key) {
  return request(
    baseUrl,
    customer,
    'POST',
    '/transfers/send',
    transferBody(customer, beneficiary, amount, quoteId),
    { 'X-Idempotency-Key': key }
  );
}

async function assertCustomerLedgerConsistent(customer) {
  const wallets = await prisma.wallet.findMany({
    where: { userId: customer.user.id },
    include: { shadowAccount: true },
  });
  for (const wallet of wallets) {
    assert.equal(
      wallet.balance.toFixed(4),
      wallet.shadowAccount.currentBalance.toFixed(4),
      `${wallet.currency} wallet and shadow ledger account must agree`
    );
    assert(wallet.balance.greaterThanOrEqualTo(0), `${wallet.currency} wallet must not be negative`);
  }
  const activities = await prisma.walletActivity.findMany({
    where: { userId: customer.user.id, transactionId: { not: null } },
    select: { transactionId: true },
  });
  for (const activity of activities) {
    const entries = await prisma.entry.findMany({ where: { transactionId: activity.transactionId } });
    assert(entries.length > 0, 'Every posted wallet activity must have ledger entries');
    assertBalanced(entries, `Wallet journal ${activity.transactionId}`);
  }
}

async function callbackRequest(prismaClient, source, body, timestamp, secret) {
  const result = { status: 0, body: null };
  await handleBankCallback(
    {
      headers: {
        'x-timestamp': timestamp,
        'x-signature': generateHmacSignature({ timestamp, body }, secret),
      },
      body,
    },
    {
      status(code) {
        result.status = code;
        return this;
      },
      json(value) {
        result.body = value;
        return this;
      },
    },
    { prisma: prismaClient, hmacSecret: secret, source }
  );
  return result;
}

async function main() {
  await prisma.$connect();
  const customerA = await seedCustomer('A', 0);
  const customerB = await seedCustomer('B', 0);

  const app = express();
  app.use(express.json());
  const orchestrator = new PaymentOrchestrator();
  app.use('/api/v1', createConsumerRouter({ prisma, orchestrator }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const topupA = await request(baseUrl, customerA, 'POST', '/wallet/topup', {
      amount: 30000,
      currency: 'PKR',
    }, { 'X-Idempotency-Key': `pg-topup-${namespace}-a` });
    assert.equal(topupA.status, 201, 'PKR test funds should post');

    const aedQuote = await quote(baseUrl, customerA, 1000, 'AE', `pg-aed-${namespace}`);
    const aedTransfer = await transfer(
      baseUrl, customerA, customerA.beneficiaries.AE, 1000, aedQuote.quoteId, `pg-send-aed-${namespace}`
    );
    assert.equal(aedTransfer.status, 201, `PKR-to-AED transfer should post: ${JSON.stringify(aedTransfer.body)}`);
    const consumedAedQuote = await prisma.fxQuote.findUnique({ where: { quoteId: aedQuote.quoteId } });
    assert.equal(consumedAedQuote.state, 'CONSUMED', 'FX quote must commit as consumed with the transfer');
    assert(consumedAedQuote.consumedAt instanceof Date, 'Consumed FX quote must persist its consumption timestamp');
    const aedJournal = await prisma.transaction.findUnique({
      where: { id: aedTransfer.body.transfer.transactionId },
      include: { entries: { include: { account: true } } },
    });
    assertBalanced(aedJournal.entries, 'PKR-to-AED journal');
    assert(aedJournal.entries.some(entry => entry.account.accountNumber === 'FX-TRANSFER-POSITION-CLEARING'), 'PKR-to-AED journal must use FX position clearing');
    assert(aedJournal.entries.some(entry => entry.account.accountNumber === 'FX-TRANSFER-FEE-REVENUE'), 'PKR-to-AED journal must record disclosed fee revenue');
    const topupActivity = await prisma.walletActivity.findFirst({
      where: { userId: customerA.user.id, kind: 'TOP_UP' },
      include: { transaction: { include: { entries: true } } },
    });
    assert(topupActivity.transaction.entries.every(entry => entry.currency === 'PKR'), 'Same-currency top-up journal must retain PKR legs');
    const roundingTopup = await request(baseUrl, customerA, 'POST', '/wallet/topup', {
      amount: 0.03,
      currency: 'PKR',
    }, { 'X-Idempotency-Key': `pg-rounding-${namespace}` });
    assert.equal(roundingTopup.status, 201, 'Minor-unit PKR top-up should post');
    const roundingJournal = await prisma.transaction.findUnique({
      where: { reference: roundingTopup.body.reference },
      include: { entries: true },
    });
    assert(roundingJournal.entries.every(entry => entry.amount.toFixed(4) === '0.0300'), 'PKR journal amount must preserve the currency minor unit');
    assert(roundingJournal.entries.every(entry => entry.baseAmount.toFixed(4) === '0.0001'), 'USD base valuation must round to four decimal places');

    const sarQuote = await quote(baseUrl, customerA, 1000, 'SA', `pg-sar-${namespace}`);
    const sarTransfer = await transfer(
      baseUrl, customerA, customerA.beneficiaries.SA, 1000, sarQuote.quoteId, `pg-send-sar-${namespace}`
    );
    assert.equal(sarTransfer.status, 201, `PKR-to-SAR transfer should post: ${JSON.stringify(sarTransfer.body)}`);

    const quoteRace = await quote(baseUrl, customerA, 1000, 'AE', `pg-quote-race-${namespace}`);
    const quoteRaceResponses = await Promise.all([
      transfer(baseUrl, customerA, customerA.beneficiaries.AE, 1000, quoteRace.quoteId, `pg-quote-race-a-${namespace}`),
      transfer(baseUrl, customerA, customerA.beneficiaries.AE, 1000, quoteRace.quoteId, `pg-quote-race-b-${namespace}`),
    ]);
    assert.equal(quoteRaceResponses.filter(result => result.status === 201).length, 1, 'Only one concurrent request may consume an FX quote');
    assert(quoteRaceResponses.every(result => [201, 409].includes(result.status)), 'Losing quote-consumption request should receive a conflict');

    const sameKeyQuote = await quote(baseUrl, customerA, 1000, 'SA', `pg-idempotency-quote-${namespace}`);
    const duplicateKey = `pg-duplicate-transfer-${namespace}`;
    const duplicateResponses = await Promise.all([
      transfer(baseUrl, customerA, customerA.beneficiaries.SA, 1000, sameKeyQuote.quoteId, duplicateKey),
      transfer(baseUrl, customerA, customerA.beneficiaries.SA, 1000, sameKeyQuote.quoteId, duplicateKey),
    ]);
    const duplicateReference = `XFER-${customerA.user.id.slice(0, 8)}-${createHash('sha256').update(duplicateKey).digest('hex').slice(0, 24)}`;
    const duplicateActivities = await prisma.walletActivity.findMany({ where: { reference: duplicateReference } });
    assert.equal(duplicateActivities.length, 1, 'Concurrent same-key initiation must create one wallet activity');
    assert(duplicateResponses.some(result => result.status === 201), 'One same-key transfer request should succeed');
    assert(duplicateResponses.every(result => [200, 201, 409].includes(result.status)), 'Duplicate same-key request should replay or conflict, not fail unexpectedly');
    const replay = await transfer(baseUrl, customerA, customerA.beneficiaries.SA, 1000, sameKeyQuote.quoteId, duplicateKey);
    assert.equal(replay.status, 200, 'A committed same-key retry should return its existing result');
    assert.equal(replay.body.replay, true, 'A committed same-key retry should be marked as a replay');

    const insufficientTopup = await request(baseUrl, customerB, 'POST', '/wallet/topup', {
      amount: 5000,
      currency: 'PKR',
    }, { 'X-Idempotency-Key': `pg-topup-${namespace}-b` });
    assert.equal(insufficientTopup.status, 201, 'Concurrency test funds should post');
    const walletRaceQuotes = await Promise.all([
      quote(baseUrl, customerB, 4000, 'AE', `pg-wallet-quote-a-${namespace}`),
      quote(baseUrl, customerB, 4000, 'AE', `pg-wallet-quote-b-${namespace}`),
    ]);
    const walletRaceResponses = await Promise.all(walletRaceQuotes.map((item, index) =>
      transfer(
        baseUrl,
        customerB,
        customerB.beneficiaries.AE,
        4000,
        item.quoteId,
        `pg-wallet-race-${index}-${namespace}`
      )));
    assert.equal(walletRaceResponses.filter(result => result.status === 201).length, 1, 'Only one transfer may consume insufficient shared wallet funds');
      assert.equal(walletRaceResponses.filter(result => result.status === 409).length, 1, 'Insufficient concurrent wallet debit should return a conflict');
    assert(walletRaceResponses.every(result => result.status !== 201 || result.body.transfer), 'Successful concurrent transfer must persist a transfer');
    const customerBWallet = await prisma.wallet.findUnique({
      where: { userId_currency: { userId: customerB.user.id, currency: 'PKR' } },
    });
    assert(customerBWallet.balance.greaterThanOrEqualTo(0), 'Concurrent transfer may not make wallet balance negative');

    const originalTransfer = aedTransfer.body.transfer;
    const reversalResponses = await Promise.all([
      request(baseUrl, customerA, 'POST', `/admin/transactions/${originalTransfer.transactionId}/reverse`, {
        reason: 'PostgreSQL concurrent reversal test',
      }, { 'x-admin-key': process.env.LEDGER_ADMIN_KEY }),
      request(baseUrl, customerA, 'POST', `/admin/transactions/${originalTransfer.transactionId}/reverse`, {
        reason: 'PostgreSQL concurrent reversal test',
      }, { 'x-admin-key': process.env.LEDGER_ADMIN_KEY }),
    ]);
    assert.equal(reversalResponses.filter(result => result.status === 201).length, 1, `Only one concurrent reversal may be posted: ${JSON.stringify(reversalResponses.map(result => result.status))}`);
    assert(reversalResponses.every(result => [201, 409].includes(result.status)), 'Losing concurrent reversal must return a conflict');
    const originalJournal = await prisma.transaction.findUnique({
      where: { id: originalTransfer.transactionId },
      include: { reversals: true },
    });
    assert.equal(originalJournal.reversals.length, 1, 'A reversal must have exactly one compensating transaction');

    const callbackBody = {
      messageId: `PGTEST-${namespace}-CALLBACK`,
      originalEndToEndId: `PGTEST-${namespace}-E2E`,
      originalUetr: originalTransfer.uetr,
      transactionStatus: 'PDNG',
      instructingBic: 'MEZNBPKK',
      instructedBic: 'FABAEADU',
    };
    const callbackTimestamp = new Date().toISOString();
    const firstCallback = await callbackRequest(prisma, 'EXTERNAL_UNVERIFIED', callbackBody, callbackTimestamp, callbackSecret);
    const duplicateCallback = await callbackRequest(prisma, 'EXTERNAL_UNVERIFIED', callbackBody, callbackTimestamp, callbackSecret);
    assert.equal(firstCallback.status, 200, 'Authenticated callback should persist to the inbox');
    assert.equal(firstCallback.body.persisted, true, 'Callback response should acknowledge durable persistence');
    assert.equal(firstCallback.body.settlementVerified, false, 'Callback receipt must not imply settlement');
    assert.equal(duplicateCallback.body.duplicate, true, 'Duplicate callback delivery should be idempotent');
    assert.equal(await prisma.callbackInbox.count({
      where: { source: 'EXTERNAL_UNVERIFIED', messageId: callbackBody.messageId },
    }), 1, 'Unique callback key should prevent duplicate inbox rows');
    const unchangedTransfer = await prisma.transfer.findUnique({ where: { id: originalTransfer.id } });
    assert.equal(unchangedTransfer.status, 'REVERSED', 'Callback processing must not alter transfer lifecycle');
    const simulatedCallback = await callbackRequest(
      prisma,
      'SIMULATED',
      callbackBody,
      callbackTimestamp,
      'test-only-simulated-callback-hmac-secret'
    );
    assert.equal(simulatedCallback.body.source, 'SIMULATED', 'Simulated callback must be separately categorized');
    assert.equal(await prisma.callbackInbox.count({
      where: { messageId: callbackBody.messageId },
    }), 2, 'External and simulated callback records must have distinct idempotency namespaces');
    const expiredCallback = await callbackRequest(
      prisma,
      'EXTERNAL_UNVERIFIED',
      { ...callbackBody, messageId: `PGTEST-${namespace}-EXPIRED` },
      new Date(Date.now() - 10 * 60 * 1000).toISOString(),
      callbackSecret
    );
    assert.equal(expiredCallback.status, 401, 'Expired signed callback must be rejected');

    await prisma.reconciliationRecord.create({
      data: {
        source: 'POSTGRES_TEST_STATEMENT',
        externalReference: `PGTEST-${namespace}-STATEMENT`,
        externalUetr: originalTransfer.uetr,
        transactionId: originalTransfer.transactionId,
        statementDate: new Date(),
        amount: new Prisma.Decimal('1000'),
        currency: 'PKR',
        externalStatus: 'PENDING',
        details: { settlementVerified: false },
      },
    });

    const nostroAccount = await prisma.account.create({
      data: {
        accountNumber: `PGTEST-NOSTRO-${namespace}`,
        name: 'PostgreSQL concurrency reservation test',
        type: 'ASSET',
        currency: 'PKR',
        currentBalance: 1000,
      },
    });
    await prisma.nostroVostroBalance.create({
      data: {
        accountId: nostroAccount.id,
        bankCode: `T${namespace.slice(0, 10)}`,
        bankName: 'PostgreSQL test bank',
        currency: 'PKR',
        currentBalance: 1000,
        reservedBalance: 0,
        availableBalance: 1000,
        minimumThreshold: 100,
        maximumThreshold: 5000,
        targetBalance: 1000,
      },
    });
    const reserve = () => prisma.$transaction(async tx => {
      const [row] = await tx.$queryRaw`
        SELECT reserve_nostro_liquidity(${`T${namespace.slice(0, 10)}`}, ${'PKR'}, ${new Prisma.Decimal('700')}) AS reserved
      `;
      return row.reserved;
    });
    const reservations = await Promise.all([reserve(), reserve()]);
    assert.equal(reservations.filter(Boolean).length, 1, 'Row-locked liquidity reservation should allow one concurrent winner');
    const nostro = await prisma.nostroVostroBalance.findUnique({
      where: { bankCode_currency: { bankCode: `T${namespace.slice(0, 10)}`, currency: 'PKR' } },
    });
    assert.equal(nostro.reservedBalance.toFixed(4), '700.0000', 'Concurrent reservations must not over-reserve nostro funds');
    await assert.rejects(
      prisma.$queryRaw`SELECT reserve_nostro_liquidity(${`T${namespace.slice(0, 10)}`}, ${'PKR'}, ${new Prisma.Decimal('-1')})`,
      /Nostro reservation amount must be positive/
    );

    const rollbackReference = `PGTEST-ROLLBACK-${namespace}`;
    const beforeRollback = await prisma.wallet.findUnique({
      where: { userId_currency: { userId: customerA.user.id, currency: 'PKR' } },
    });
    await assert.rejects(prisma.$transaction(async tx => {
      await tx.wallet.update({
        where: { id: beforeRollback.id },
        data: { balance: { decrement: 1 } },
      });
      await tx.transaction.create({
        data: {
          reference: rollbackReference,
          type: 'POSTGRES_ROLLBACK_TEST',
          corridorCode: 'TEST',
          status: 'POSTED',
          totalDebitBase: 1,
          totalCreditBase: 1,
          currency: 'USD',
          postedAt: new Date(),
        },
      });
      throw new Error('intentional partial-processing rollback');
    }), /intentional partial-processing rollback/);
    const afterRollback = await prisma.wallet.findUnique({ where: { id: beforeRollback.id } });
    assert.equal(afterRollback.balance.toFixed(4), beforeRollback.balance.toFixed(4), 'Partial transaction failure must restore wallet balance');
    assert.equal(await prisma.transaction.count({ where: { reference: rollbackReference } }), 0, 'Partial transaction failure must not persist a journal');

    await assert.rejects(
      prisma.wallet.update({
        where: { id: beforeRollback.id },
        data: { balance: { increment: 1 } },
      }),
      /Wallet balance must equal its shadow ledger account balance/
    );
    const afterMismatch = await prisma.wallet.findUnique({ where: { id: beforeRollback.id } });
    assert.equal(afterMismatch.balance.toFixed(4), beforeRollback.balance.toFixed(4), 'Database must reject wallet/shadow-ledger divergence');
    await assert.rejects(
      prisma.wallet.update({
        where: { id: beforeRollback.id },
        data: { balance: { decrement: 1000000000 } },
      }),
      /wallets_balance_nonnegative_check/
    );

    const unbalancedReference = `PGTEST-UNBALANCED-${namespace}`;
    const debitAccount = await prisma.account.create({
      data: {
        accountNumber: `PGTEST-DEBIT-${namespace}`,
        name: 'PostgreSQL unbalanced journal test debit',
        type: 'ASSET',
        currency: 'USD',
      },
    });
    await assert.rejects(prisma.$transaction(async tx => {
      const transaction = await tx.transaction.create({
        data: {
          reference: unbalancedReference,
          type: 'POSTGRES_UNBALANCED_TEST',
          corridorCode: 'TEST',
          status: 'POSTED',
          totalDebitBase: 1,
          totalCreditBase: 1,
          currency: 'USD',
          postedAt: new Date(),
        },
      });
      await tx.entry.create({
        data: {
          transactionId: transaction.id,
          accountId: debitAccount.id,
          direction: 'DEBIT',
          amount: 1,
          currency: 'USD',
          exchangeRate: 1,
          baseAmount: 1,
          sequenceOrder: 1,
        },
      });
    }), 'Deferred double-entry trigger must reject an unbalanced journal at commit');
    assert.equal(await prisma.transaction.count({ where: { reference: unbalancedReference } }), 0, 'Unbalanced journal must fully roll back');
    const emptyPostedReference = `PGTEST-EMPTY-POSTED-${namespace}`;
    await assert.rejects(prisma.transaction.create({
      data: {
        reference: emptyPostedReference,
        type: 'POSTGRES_EMPTY_POSTED_TEST',
        corridorCode: 'TEST',
        status: 'POSTED',
        totalDebitBase: 0,
        totalCreditBase: 0,
        currency: 'USD',
        postedAt: new Date(),
      },
    }), /at least two ledger entries/);
    assert.equal(await prisma.transaction.count({ where: { reference: emptyPostedReference } }), 0, 'Empty posted journal must be rejected');

    await assertCustomerLedgerConsistent(customerA);
    await assertCustomerLedgerConsistent(customerB);
    console.log('PostgreSQL integration checks passed: FX corridors, same-currency journal, clearing/fees, quote and wallet races, idempotency, reversal, callback inbox, nostro reservations, and rollback invariants.');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

main()
  .catch(error => {
    console.error('PostgreSQL integration checks failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
