import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcryptjs';
import express from 'express';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { validateBic, validateIban } from '../iso20022/validator.js';
import { CORRIDOR_CONFIGURATIONS } from '../treasury/corridor-rates.js';
import { TokenBucketRateLimiter } from './security.js';
import { assertTransferTransition, transitionTransfer } from './transfer-lifecycle.js';
import { makeStaffAuthMiddleware } from './staff-auth.js';

const baseUsdRates = {
  PKR: new Prisma.Decimal('0.003578'),
  AED: new Prisma.Decimal('0.272294'),
  SAR: new Prisma.Decimal('0.266667'),
  USD: new Prisma.Decimal('1'),
};

const Decimal = Prisma.Decimal;
const JWT_ISSUER = 'crossborder-payment-orchestrator';
const JWT_AUDIENCE = 'consumer-app';
const currencies = ['PKR', 'AED', 'SAR'];
const currencyPrecision = { PKR: 2, AED: 2, SAR: 2, USD: 4 };
const registerSchema = z.object({
  fullName: z.string().trim().min(2).max(128),
  email: z.string().email().max(255),
  phone: z.string().min(8).max(32),
  password: z.string().min(10).max(128),
  pin: z.string().regex(/^\d{6}$/, 'PIN must contain exactly 6 digits'),
});
const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
const topUpSchema = z.object({
  amount: z.number().finite().min(0.01).max(100000000),
  currency: z.enum(currencies),
});
const beneficiarySchema = z.object({
  fullName: z.string().trim().min(2).max(128),
  iban: z.string().trim().min(15).max(34),
  bic: z.string().trim().min(8).max(11),
  bankName: z.string().trim().min(2).max(128),
  country: z.enum(['AE', 'SA']),
});
const transferSchema = z.object({
  amount: z.number().finite().positive().max(100000000),
  sourceCurrency: z.enum(currencies),
  beneficiaryId: z.string().uuid(),
  purpose: z.enum(['FAMILY_SUPPORT', 'EDUCATION', 'MEDICAL', 'SAVINGS', 'OTHER']),
  pin: z.string().regex(/^\d{6}$/),
  quoteId: z.string().uuid(),
});
const quoteSchema = z.object({
  amount: z.number().finite().positive().max(100000000),
  sourceCurrency: z.enum(currencies),
  country: z.enum(['AE', 'SA']),
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  fileFilter(_req, file, callback) {
    if (!['image/jpeg', 'image/png', 'application/pdf'].includes(file.mimetype)) {
      callback(new Error('Upload a JPEG, PNG, or PDF identity document'));
      return;
    }
    callback(null, true);
  },
});

function validDocumentMime(buffer, mimeType) {
  if (mimeType === 'image/jpeg') {
    return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  if (mimeType === 'image/png') {
    return buffer.length >= 8
      && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  if (mimeType === 'application/pdf') {
    return buffer.subarray(0, 5).toString('ascii') === '%PDF-';
  }
  return false;
}

function isAuthorizedWithKey(req, environmentVariable) {
  const expectedKey = process.env[environmentVariable];
  const suppliedKey = req.headers['x-admin-key'];
  if (typeof expectedKey !== 'string' || expectedKey.length < 32
    || typeof suppliedKey !== 'string') {
    return false;
  }
  const expected = Buffer.from(expectedKey);
  const supplied = Buffer.from(suppliedKey);
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

function isAuthorizedLedgerReviewer(req) {
  return isAuthorizedWithKey(req, 'LEDGER_ADMIN_KEY');
}

function round4(value) {
  return new Decimal(value.toString()).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
}

function roundAmount(value, currency) {
  const precision = currencyPrecision[currency];
  if (precision === undefined) throw new Error(`Unsupported currency ${currency}`);
  return new Decimal(value.toString()).toDecimalPlaces(precision, Decimal.ROUND_HALF_UP);
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function validateBody(schema, body) {
  const result = schema.safeParse(body);
  if (!result.success) {
    return { error: result.error.issues.map(issue => issue.message).join('; ') };
  }
  return { data: result.data };
}

function makeAuthMiddleware() {
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret || jwtSecret.length < 32) {
    throw new Error('JWT_SECRET must be configured with at least 32 characters');
  }

  return (req, res, next) => {
    const authorization = req.headers.authorization || '';
    const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    if (!token) return res.status(401).json({ error: 'Authentication required' });

    try {
      const decoded = jwt.verify(token, jwtSecret, {
        algorithms: ['HS256'],
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
      });
      if (typeof decoded !== 'object' || typeof decoded.sub !== 'string') {
        return res.status(401).json({ error: 'Invalid access token' });
      }
      req.auth = { userId: decoded.sub };
      return next();
    } catch {
      return res.status(401).json({ error: 'Invalid or expired access token' });
    }
  };
}

async function ensureWallet(tx, userId, currency) {
  let wallet = await tx.wallet.findUnique({
    where: { userId_currency: { userId, currency } },
  });
  if (wallet) return wallet;

  const account = await tx.account.create({
    data: {
      accountNumber: `WALLET-${randomUUID()}`,
      name: `Customer ${currency} wallet liability`,
      type: 'LIABILITY',
      currency,
    },
  });
  wallet = await tx.wallet.create({
    data: {
      userId,
      currency,
      shadowAccountId: account.id,
    },
  });
  return wallet;
}

function ensurePlatformAccount(tx, accountNumber, name, currency, bankIdentifier, initialBalance = 0, type = 'ASSET') {
  return tx.account.upsert({
    where: { accountNumber },
    update: {},
    create: {
      accountNumber,
      name,
      type,
      currency,
      bankIdentifier,
      currentBalance: initialBalance,
    },
  });
}

async function postJournal(tx, {
  reference,
  type,
  corridorCode,
  description,
  uetr,
  reversalOfId,
  reversalReason,
  legs,
}) {
  const resolvedLegs = [];
  let debitTotal = new Decimal(0);
  let creditTotal = new Decimal(0);

  for (const [index, leg] of legs.entries()) {
    const amount = roundAmount(leg.amount, leg.currency);
    const exchangeRate = new Decimal(leg.exchangeRate.toString());
    if (!amount.isFinite() || !amount.isPositive() || !exchangeRate.isFinite() || !exchangeRate.isPositive()) {
      throw new Error(`Invalid financial amount or exchange rate on journal leg ${index + 1}`);
    }
    const account = await tx.account.findUniqueOrThrow({ where: { id: leg.accountId } });
    if (account.currency !== leg.currency) {
      throw new Error(`Currency mismatch for ledger account ${account.accountNumber}`);
    }
    const baseAmount = round4(amount.mul(exchangeRate));
    if (leg.direction === 'DEBIT') debitTotal = debitTotal.plus(baseAmount);
    else if (leg.direction === 'CREDIT') creditTotal = creditTotal.plus(baseAmount);
    else throw new Error(`Invalid ledger direction on journal leg ${index + 1}`);
    resolvedLegs.push({ ...leg, amount, exchangeRate, baseAmount, account });
  }

  if (!debitTotal.equals(creditTotal)) {
    throw new Error(`Wallet ledger imbalance: debit ${debitTotal.toString()} USD, credit ${creditTotal.toString()} USD`);
  }

  const transaction = await tx.transaction.create({
    data: {
      reference,
      uetr,
      type,
      corridorCode,
      status: 'POSTED',
      totalDebitBase: debitTotal,
      totalCreditBase: creditTotal,
      currency: 'USD',
      description,
      postedAt: new Date(),
      reversalOfId,
      reversalReason,
    },
  });

  const balanceChanges = new Map();
  for (const [index, leg] of resolvedLegs.entries()) {
    await tx.entry.create({
      data: {
        transactionId: transaction.id,
        accountId: leg.accountId,
        direction: leg.direction,
        amount: leg.amount,
        currency: leg.currency,
        exchangeRate: leg.exchangeRate,
        baseAmount: leg.baseAmount,
        sequenceOrder: index + 1,
        description: leg.description,
      },
    });
    const debitIncreasesBalance = leg.account.type === 'ASSET' || leg.account.type === 'EXPENSE';
    const increasesBalance = leg.direction === 'DEBIT' ? debitIncreasesBalance : !debitIncreasesBalance;
    const signedAmount = increasesBalance ? leg.amount : leg.amount.negated();
    const previous = balanceChanges.get(leg.accountId);
    balanceChanges.set(leg.accountId, {
      account: leg.account,
      amount: (previous?.amount || new Decimal(0)).plus(signedAmount),
    });
  }

  for (const { account, amount } of balanceChanges.values()) {
    const newBalance = account.currentBalance.plus(amount);
    if (newBalance.isNegative()) {
      throw new Error(`Insufficient ledger balance for account ${account.accountNumber}`);
    }
    const increasesBalance = amount.isPositive();
    const balanceResult = await tx.account.updateMany({
      where: {
        id: account.id,
        ...(!increasesBalance ? { currentBalance: { gte: amount.abs() } } : {}),
      },
      data: {
        currentBalance: increasesBalance
          ? { increment: amount }
          : { decrement: amount.abs() },
      },
    });
    if (balanceResult.count !== 1) {
      throw new Error(`Ledger balance changed while posting account ${account.accountNumber}`);
    }
  }
  return transaction;
}

function idempotencyKey(req) {
  const provided = req.headers['x-idempotency-key'];
  return typeof provided === 'string' && provided.length > 0 && provided.length <= 64
    ? provided
    : null;
}

function scopedReference(kind, userId, key) {
  const digest = createHash('sha256').update(key).digest('hex').slice(0, 24);
  return `${kind}-${userId.slice(0, 8)}-${digest}`;
}

export function createConsumerRouter({
  prisma,
  orchestrator,
  kycEncryption = null,
  staffTokenVerifier,
}) {
  const router = express.Router();
  const authenticate = makeAuthMiddleware();
  const authenticateKycStaff = makeStaffAuthMiddleware(
    ['KYC_REVIEWER', 'KYC_ADMIN'],
    staffTokenVerifier
  );
  const authenticateKycReviewer = makeStaffAuthMiddleware(['KYC_REVIEWER'], staffTokenVerifier);
  const authenticateKycAdmin = makeStaffAuthMiddleware(['KYC_ADMIN'], staffTokenVerifier);
  const jwtSecret = process.env.JWT_SECRET;
  const registerRateLimiter = new TokenBucketRateLimiter(5, 1 / 60);
  const loginRateLimiter = new TokenBucketRateLimiter(10, 1 / 30);
  const pinRateLimiter = new TokenBucketRateLimiter(5, 1 / 60);
  const kycUploadRateLimiter = new TokenBucketRateLimiter(3, 1 / 3600);

  router.post('/auth/register', asyncRoute(async (req, res) => {
    if (!registerRateLimiter.consume(`register:${req.ip || 'unknown'}`)) {
      return res.status(429).json({ error: 'Too many registration attempts; try again later' });
    }
    const parsed = validateBody(registerSchema, req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });

    const email = parsed.data.email.trim().toLowerCase();
    const phone = parsed.data.phone.trim();
    const [emailExists, phoneExists] = await Promise.all([
      prisma.user.findUnique({ where: { email }, select: { id: true } }),
      prisma.user.findUnique({ where: { phone }, select: { id: true } }),
    ]);
    if (emailExists || phoneExists) {
      return res.status(409).json({ error: 'An account with this email or phone already exists' });
    }

    const [passwordHash, pinHash] = await Promise.all([
      bcrypt.hash(parsed.data.password, 12),
      bcrypt.hash(parsed.data.pin, 12),
    ]);
    const user = await prisma.$transaction(async tx => {
      const createdUser = await tx.user.create({
        data: { fullName: parsed.data.fullName.trim(), email, phone, passwordHash, pinHash },
      });
      await ensureWallet(tx, createdUser.id, 'PKR');
      return createdUser;
    });
    const token = jwt.sign({}, jwtSecret, {
      subject: user.id,
      expiresIn: '12h',
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      algorithm: 'HS256',
    });
    return res.status(201).json({
      token,
      user: { id: user.id, fullName: user.fullName, email: user.email, phone: user.phone, kycStatus: user.kycStatus },
    });
  }));

  router.post('/auth/login', asyncRoute(async (req, res) => {
    if (!loginRateLimiter.consume(`login:${req.ip || 'unknown'}`)) {
      return res.status(429).json({ error: 'Too many login attempts; try again later' });
    }
    const parsed = validateBody(loginSchema, req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const user = await prisma.user.findUnique({
      where: { email: parsed.data.email.trim().toLowerCase() },
    });
    if (!user || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    const token = jwt.sign({}, jwtSecret, {
      subject: user.id,
      expiresIn: '12h',
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      algorithm: 'HS256',
    });
    return res.json({
      token,
      user: { id: user.id, fullName: user.fullName, email: user.email, phone: user.phone, kycStatus: user.kycStatus },
    });
  }));

  router.post('/auth/kyc', authenticate, upload.single('document'), asyncRoute(async (req, res) => {
    if (!kycUploadRateLimiter.consume(`kyc:${req.auth.userId}`)) {
      return res.status(429).json({ error: 'Too many identity document submissions; try again later' });
    }
    const documentType = req.body.documentType;
    if (!['CNIC', 'PASSPORT'].includes(documentType)) {
      return res.status(400).json({ error: 'documentType must be CNIC or PASSPORT' });
    }
    if (!req.file) return res.status(400).json({ error: 'Identity document file is required' });
    if (!validDocumentMime(req.file.buffer, req.file.mimetype)) {
      return res.status(400).json({ error: 'Identity document content does not match its declared file type' });
    }
    if (!kycEncryption) {
      return res.status(503).json({ error: 'Encrypted KYC document storage is not configured' });
    }
    const fileName = req.file.originalname
      .split(/[\\/]/)
      .pop()
      .replace(/[\r\n"]/g, '_')
      .slice(0, 255);

    const document = await prisma.$transaction(async tx => {
      const documentId = randomUUID();
      const encryptedDocument = kycEncryption.encrypt(documentId, req.file.buffer);
      const savedDocument = await tx.kycDocument.create({
        data: {
          id: documentId,
          userId: req.auth.userId,
          documentType,
          fileName,
          mimeType: req.file.mimetype,
          ...encryptedDocument,
        },
        select: { id: true, documentType: true, createdAt: true },
      });
      await tx.user.update({
        where: { id: req.auth.userId },
        data: { kycStatus: 'PENDING' },
      });
      return savedDocument;
    });
    return res.status(202).json({
      documentId: document.id,
      kycStatus: 'PENDING',
      message: 'Identity document submitted for review',
    });
  }));

  router.get('/admin/kyc', authenticateKycStaff, asyncRoute(async (req, res) => {
    const applicants = await prisma.user.findMany({
      where: { kycStatus: 'PENDING' },
      select: {
        id: true,
        fullName: true,
        email: true,
        kycDocuments: {
          orderBy: { createdAt: 'desc' },
          select: { id: true, documentType: true, fileName: true, createdAt: true },
        },
      },
      orderBy: { updatedAt: 'asc' },
    });
    return res.json({ applicants });
  }));

  router.post('/admin/kyc/:userId/review', authenticateKycReviewer, asyncRoute(async (req, res) => {
    const userId = z.string().uuid().safeParse(req.params.userId);
    const body = z.object({
      status: z.enum(['APPROVED', 'REJECTED']),
      reason: z.string().trim().min(3).max(1000),
    }).safeParse(req.body);
    if (!userId.success || !body.success) {
      return res.status(400).json({ error: 'A valid userId, decision, and review reason are required' });
    }
    const result = await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId.data}::uuid FOR UPDATE`;
      const user = await tx.user.findUnique({ where: { id: userId.data } });
      if (!user) return { notFound: true };
      if (user.kycStatus !== 'PENDING') return { conflict: true };

      const updated = await tx.user.updateMany({
        where: { id: userId.data, kycStatus: 'PENDING' },
        data: { kycStatus: body.data.status },
      });
      if (updated.count !== 1) return { conflict: true };
      const event = await tx.kycReviewEvent.create({
        data: {
          userId: userId.data,
          reviewerId: req.staffIdentity.reviewerId,
          reviewerIssuer: req.staffIdentity.issuer,
          action: 'REVIEW',
          previousStatus: user.kycStatus,
          decision: body.data.status,
          reason: body.data.reason,
        },
      });
      return { user: { id: user.id, kycStatus: body.data.status }, review: event };
    });
    if (result.notFound) return res.status(404).json({ error: 'KYC applicant not found' });
    if (result.conflict) return res.status(409).json({ error: 'Only a pending KYC application can be reviewed' });
    return res.json(result);
  }));

  router.post('/admin/kyc/:userId/corrections', authenticateKycAdmin, asyncRoute(async (req, res) => {
    const userId = z.string().uuid().safeParse(req.params.userId);
    const body = z.object({
      status: z.enum(['APPROVED', 'REJECTED']),
      reason: z.string().trim().min(3).max(1000),
    }).safeParse(req.body);
    if (!userId.success || !body.success) {
      return res.status(400).json({ error: 'A valid userId, corrected decision, and reason are required' });
    }

    const result = await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId.data}::uuid FOR UPDATE`;
      const user = await tx.user.findUnique({ where: { id: userId.data } });
      if (!user) return { notFound: true };
      if (!['APPROVED', 'REJECTED'].includes(user.kycStatus)) return { conflict: true };
      const previousReview = await tx.kycReviewEvent.findFirst({
        where: { userId: userId.data },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      if (!previousReview) return { conflict: true };
      if (user.kycStatus === body.data.status) return { conflict: true };

      await tx.user.update({
        where: { id: userId.data },
        data: { kycStatus: body.data.status },
      });
      const correction = await tx.kycReviewEvent.create({
        data: {
          userId: userId.data,
          reviewerId: req.staffIdentity.reviewerId,
          reviewerIssuer: req.staffIdentity.issuer,
          action: 'CORRECTION',
          previousStatus: user.kycStatus,
          decision: body.data.status,
          reason: body.data.reason,
          correctionOfId: previousReview.id,
        },
      });
      return { user: { id: user.id, kycStatus: body.data.status }, correction };
    });
    if (result.notFound) return res.status(404).json({ error: 'KYC applicant not found' });
    if (result.conflict) {
      return res.status(409).json({ error: 'A correction requires a prior final decision and a different status' });
    }
    return res.json(result);
  }));

  router.get('/admin/kyc/:userId/reviews', authenticateKycAdmin, asyncRoute(async (req, res) => {
    const userId = z.string().uuid().safeParse(req.params.userId);
    if (!userId.success) return res.status(400).json({ error: 'userId must be a UUID' });
    const reviews = await prisma.kycReviewEvent.findMany({
      where: { userId: userId.data },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return res.json({ reviews });
  }));

  router.get('/admin/kyc/:userId/documents/:documentId', authenticateKycStaff, asyncRoute(async (req, res) => {
    const userId = z.string().uuid().safeParse(req.params.userId);
    const documentId = z.string().uuid().safeParse(req.params.documentId);
    if (!userId.success || !documentId.success) {
      return res.status(400).json({ error: 'userId and documentId must be UUIDs' });
    }
    const document = await prisma.kycDocument.findFirst({
      where: { id: documentId.data, userId: userId.data },
      select: {
        id: true,
        documentType: true,
        fileName: true,
        mimeType: true,
        fileData: true,
        ciphertext: true,
        encryptionNonce: true,
        authenticationTag: true,
        keyVersion: true,
        wrappedDataKey: true,
        keyWrapNonce: true,
        keyWrapTag: true,
        encryptionAlgorithm: true,
        createdAt: true,
      },
    });
    if (!document) return res.status(404).json({ error: 'KYC document not found' });
    if (document.fileData || !document.ciphertext) {
      return res.status(409).json({ error: 'Legacy KYC document requires the explicit encryption migration before retrieval' });
    }
    if (!kycEncryption) {
      return res.status(503).json({ error: 'KYC document decryption is not configured' });
    }
    let decrypted;
    try {
      decrypted = kycEncryption.decrypt(document);
    } catch {
      console.error('[KYC_DOCUMENT_DECRYPTION_ERROR] Authenticated document decryption failed');
      return res.status(500).json({ error: 'KYC document could not be decrypted' });
    }
    res.type(document.mimeType);
    res.set('X-Content-Type-Options', 'nosniff');
    res.attachment(document.fileName);
    res.set('Cache-Control', 'private, no-store');
    return res.send(decrypted);
  }));

  router.post('/admin/transactions/:transactionId/reverse', asyncRoute(async (req, res) => {
    if (!isAuthorizedLedgerReviewer(req)) {
      return res.status(401).json({ error: 'Ledger reviewer authorization required' });
    }
    const transactionId = z.string().uuid().safeParse(req.params.transactionId);
    const parsed = z.object({ reason: z.string().trim().min(3).max(255) }).safeParse(req.body);
    if (!transactionId.success || !parsed.success) {
      return res.status(400).json({ error: 'A transaction UUID and reversal reason are required' });
    }

    let result;
    try {
      result = await prisma.$transaction(async tx => {
        const original = await tx.transaction.findUnique({
          where: { id: transactionId.data },
          include: {
            entries: { orderBy: { sequenceOrder: 'asc' } },
            walletActivities: true,
            reversals: { select: { id: true } },
            transfer: { select: { id: true, status: true } },
          },
        });
        if (!original) return { notFound: true };
        if (original.status !== 'POSTED' || original.reversals.length > 0) {
          return { conflict: true };
        }
        if (original.entries.length === 0) {
          throw new Error('A posted transaction without ledger entries cannot be reversed');
        }
        if (original.transfer && original.transfer.status !== 'SIMULATED') {
          throw new Error('Only simulated transfers can be reversed by this prototype endpoint');
        }
        if (original.walletActivities.length !== 1) {
          throw new Error('Only wallet transactions with exactly one activity can be reversed by this endpoint');
        }

        const activity = original.walletActivities[0];
        const reversalReference = `REV-${original.id}`;
        if (activity.kind === 'TOP_UP') {
          const debitWallet = await tx.wallet.updateMany({
            where: { id: activity.walletId, balance: { gte: activity.amount } },
            data: { balance: { decrement: activity.amount } },
          });
          if (debitWallet.count !== 1) {
            throw new Error('REVERSAL_WALLET_BALANCE_INSUFFICIENT');
          }
        } else if (activity.kind === 'TRANSFER') {
          await tx.wallet.update({
            where: { id: activity.walletId },
            data: { balance: { increment: activity.amount } },
          });
        } else {
          throw new Error(`Unsupported wallet activity kind for reversal: ${activity.kind}`);
        }

        const reversal = await postJournal(tx, {
          reference: reversalReference,
          type: 'REVERSAL',
          corridorCode: original.corridorCode,
          description: `Reversal of ${original.reference}: ${parsed.data.reason}`,
          reversalOfId: original.id,
          reversalReason: parsed.data.reason,
          legs: original.entries.map(entry => ({
            accountId: entry.accountId,
            direction: entry.direction === 'DEBIT' ? 'CREDIT' : 'DEBIT',
            amount: entry.amount,
            currency: entry.currency,
            exchangeRate: entry.exchangeRate,
            description: `Reversal of ${entry.description || original.reference}`,
          })),
        });
        const updatedOriginal = await tx.transaction.updateMany({
          where: { id: original.id, status: 'POSTED' },
          data: { status: 'REVERSED', reversalReason: parsed.data.reason, reversedAt: new Date() },
        });
        if (updatedOriginal.count !== 1) {
          throw new Error('Transaction status changed while reversal was being processed');
        }
        if (original.transfer) {
          await transitionTransfer(
            tx,
            original.transfer.id,
            'SIMULATED',
            'REVERSED',
            `DEMO_MODE: ${parsed.data.reason}`,
            'LEDGER_ADMIN'
          );
        }
        await tx.walletActivity.create({
          data: {
            userId: activity.userId,
            walletId: activity.walletId,
            transactionId: reversal.id,
            kind: 'REVERSAL',
            status: 'SIMULATED',
            amount: activity.amount,
            currency: activity.currency,
            reference: reversalReference,
            description: `Simulated reversal of ${original.reference}`,
            details: { originalReference: original.reference, reason: parsed.data.reason },
          },
        });
        return { reversal, originalReference: original.reference };
      });
    } catch (error) {
      if (error.message === 'REVERSAL_WALLET_BALANCE_INSUFFICIENT') {
        return res.status(409).json({ error: 'Wallet balance is insufficient to reverse this simulated top-up' });
      }
      if (error?.code === 'P2002') {
        return res.status(409).json({ error: 'This transaction has already been reversed' });
      }
      if (error.message.startsWith('Only wallet transactions')
        || error.message.startsWith('A posted transaction without ledger entries')
        || error.message.startsWith('Unsupported wallet activity kind')
        || error.message.startsWith('Transaction status changed')
        || error.message.startsWith('Only simulated transfers')) {
        return res.status(409).json({ error: error.message });
      }
      throw error;
    }

    if (result.notFound) return res.status(404).json({ error: 'Transaction not found' });
    if (result.conflict) return res.status(409).json({ error: 'Transaction is not posted or has already been reversed' });
    return res.status(201).json({
      reversal: result.reversal,
      originalReference: result.originalReference,
      status: 'REVERSED',
    });
  }));

  router.get('/wallet/balance', authenticate, asyncRoute(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.auth.userId },
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        kycStatus: true,
        wallets: { orderBy: { currency: 'asc' } },
        beneficiaries: { orderBy: { createdAt: 'desc' } },
        activities: { orderBy: { createdAt: 'desc' }, take: 20 },
      },
    });
    if (!user) return res.status(404).json({ error: 'User not found' });
    return res.json(user);
  }));

  router.post('/wallet/topup', authenticate, asyncRoute(async (req, res) => {
    const parsed = validateBody(topUpSchema, req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const requestKey = idempotencyKey(req);
    if (!requestKey) return res.status(400).json({ error: 'X-Idempotency-Key header is required' });
    const reference = scopedReference('TOPUP', req.auth.userId, requestKey);
    const existing = await prisma.walletActivity.findUnique({ where: { reference } });
    if (existing) return res.json({ ...existing, replay: true });

    const { currency } = parsed.data;
    const submittedAmount = new Decimal(parsed.data.amount.toString());
    const amount = roundAmount(submittedAmount, currency);
    if (!amount.equals(submittedAmount)) {
      return res.status(400).json({ error: `Amount must have no more than ${currencyPrecision[currency]} decimal places` });
    }
    let wallet;
    try {
      wallet = await prisma.$transaction(async tx => {
      const currentWallet = await ensureWallet(tx, req.auth.userId, currency);
      const clearing = await ensurePlatformAccount(
        tx,
        `TOPUP-CLEARING-${currency}`,
        `Simulated ${currency} payment rail clearing`,
        currency,
        'MEZNBPKK'
      );
      const walletAccount = await tx.account.findUniqueOrThrow({
        where: { id: currentWallet.shadowAccountId },
      });
      const rate = baseUsdRates[currency];
      const transaction = await postJournal(tx, {
        reference,
        type: 'WALLET_TOPUP',
        corridorCode: `${currency}_${currency}`,
        description: `Simulated incoming ${currency} wallet top-up`,
        legs: [
          { accountId: clearing.id, direction: 'DEBIT', amount, currency, exchangeRate: rate, description: 'Incoming payment rail deposit' },
          { accountId: walletAccount.id, direction: 'CREDIT', amount, currency, exchangeRate: rate, description: 'Customer wallet credit' },
        ],
      });
      const updatedWallet = await tx.wallet.update({
        where: { id: currentWallet.id },
        data: { balance: { increment: amount } },
      });
      await tx.walletActivity.create({
        data: {
          userId: req.auth.userId,
          walletId: updatedWallet.id,
          transactionId: transaction.id,
          kind: 'TOP_UP',
          status: 'SIMULATED',
          amount,
          currency,
          reference,
          description: 'Wallet top-up via simulated local payment rail',
        },
      });
        return updatedWallet;
      });
    } catch (error) {
      if (error?.code === 'P2002') {
        const replay = await prisma.walletActivity.findUnique({ where: { reference } });
        if (replay) return res.json({ ...replay, replay: true });
      }
      throw error;
    }
    return res.status(201).json({ wallet, reference, status: 'SIMULATED' });
  }));

  router.get('/beneficiaries', authenticate, asyncRoute(async (req, res) => {
    const beneficiaries = await prisma.beneficiary.findMany({
      where: { userId: req.auth.userId },
      orderBy: { createdAt: 'desc' },
    });
    return res.json({ beneficiaries });
  }));

  router.get('/transfers/:transferId', authenticate, asyncRoute(async (req, res) => {
    const transferId = z.string().uuid().safeParse(req.params.transferId);
    if (!transferId.success) return res.status(400).json({ error: 'transferId must be a UUID' });
    const transfer = await prisma.transfer.findFirst({
      where: { id: transferId.data, userId: req.auth.userId },
      include: {
        beneficiary: { select: { fullName: true, bankName: true, country: true, iban: true } },
        statusEvents: { orderBy: { sequenceOrder: 'asc' } },
      },
    });
    if (!transfer) return res.status(404).json({ error: 'Transfer not found' });
    return res.json({ transfer });
  }));

  router.post('/fx/quote', authenticate, asyncRoute(async (req, res) => {
    const parsed = validateBody(quoteSchema, req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const { sourceCurrency, country } = parsed.data;
    const submittedAmount = new Decimal(parsed.data.amount.toString());
    const amount = roundAmount(submittedAmount, sourceCurrency);
    if (!amount.equals(submittedAmount)) {
      return res.status(400).json({ error: `Amount must have no more than ${currencyPrecision[sourceCurrency]} decimal places` });
    }
    if (sourceCurrency !== 'PKR') {
      return res.status(400).json({ error: 'UAE and Saudi payout quotes currently require a PKR wallet' });
    }
    const corridorCode = `PK_${country}`;
    const corridor = CORRIDOR_CONFIGURATIONS[corridorCode];
    if (!corridor) return res.status(400).json({ error: 'Payout corridor is not supported' });
    const suppliedIdempotencyKey = req.headers['x-idempotency-key'];
    const requestKey = idempotencyKey(req);
    if (suppliedIdempotencyKey !== undefined && !requestKey) {
      return res.status(400).json({ error: 'X-Idempotency-Key must be between 1 and 64 characters' });
    }

    if (requestKey) {
      const existing = await prisma.fxQuote.findUnique({
        where: { userId_idempotencyKey: { userId: req.auth.userId, idempotencyKey: requestKey } },
      });
      if (existing) {
        if (existing.state !== 'ACTIVE' || existing.expiresAt <= new Date()) {
          return res.status(409).json({ error: 'This quote request key has already been used or expired' });
        }
        if (!existing.instructedAmount.equals(amount)
          || existing.corridorCode !== corridorCode
          || existing.sourceCurrency !== sourceCurrency
          || existing.targetCurrency !== corridor.targetCurrency) {
          return res.status(409).json({ error: 'Idempotency key was already used for different quote details' });
        }
        const feeAmount = roundAmount(Decimal.max(new Decimal('100'), amount.mul('0.005')), sourceCurrency);
        return res.json({
          quoteId: existing.quoteId,
          corridorCode: existing.corridorCode,
          amount: existing.instructedAmount,
          sourceCurrency: existing.sourceCurrency,
          feeAmount,
          totalDebited: roundAmount(amount.plus(feeAmount), sourceCurrency),
          payoutAmount: existing.settlementAmount,
          payoutCurrency: existing.targetCurrency,
          exchangeRate: existing.clientRate,
          rateProvider: existing.rateProvider,
          rateObservedAt: existing.rateObservedAt.toISOString(),
          expiresAt: existing.expiresAt.toISOString(),
        });
      }
    }

    try {
      const quote = orchestrator.fxEngine.generateQuote({
        corridorCode,
        sourceCurrency,
        targetCurrency: corridor.targetCurrency,
        instructedAmount: amount,
        tier: 'COMMERCIAL',
      });
      const feeAmount = roundAmount(Decimal.max(new Decimal('100'), amount.mul('0.005')), sourceCurrency);
      const quoteData = {
        quoteId: quote.quoteId,
        userId: req.auth.userId,
        idempotencyKey: requestKey,
        corridorCode: quote.corridorCode,
        sourceCurrency: quote.sourceCurrency,
        targetCurrency: quote.targetCurrency,
        instructedAmount: quote.instructedAmount,
        settlementAmount: quote.settlementAmount,
        midMarketRate: quote.midMarketRate,
        clientRate: quote.clientRate,
        spreadBps: quote.spreadBps,
        volatilityBufferBps: quote.volatilityBufferBps,
        spreadRevenue: quote.spreadRevenueAmount,
        rateProvider: quote.rateProvider,
        rateObservedAt: new Date(quote.rateObservedAt),
        state: 'ACTIVE',
        expiresAt: new Date(quote.expiresAt),
      };
      if (requestKey) {
        const saved = await prisma.fxQuote.upsert({
          where: { userId_idempotencyKey: { userId: req.auth.userId, idempotencyKey: requestKey } },
          update: {},
          create: quoteData,
        });
        if (saved.quoteId !== quote.quoteId) {
          return res.status(409).json({ error: 'This quote request key has already been used' });
        }
      } else {
        await prisma.fxQuote.create({ data: quoteData });
      }
      return res.json({
        quoteId: quote.quoteId,
        corridorCode,
        amount,
        sourceCurrency,
        feeAmount,
        totalDebited: roundAmount(amount.plus(feeAmount), sourceCurrency),
        payoutAmount: quote.settlementAmount,
        payoutCurrency: quote.targetCurrency,
        exchangeRate: quote.clientRate,
        rateProvider: quote.rateProvider,
        rateObservedAt: quote.rateObservedAt,
        expiresAt: quote.expiresAt,
      });
    } catch (error) {
      return res.status(422).json({ error: error.message });
    }
  }));

  router.post('/beneficiaries', authenticate, asyncRoute(async (req, res) => {
    const parsed = validateBody(beneficiarySchema, req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const iban = parsed.data.iban.replace(/[\s-]/g, '').toUpperCase();
    const bic = parsed.data.bic.trim().toUpperCase();
    const ibanCheck = validateIban(iban);
    if (!ibanCheck.isValid || ibanCheck.countryCode !== parsed.data.country) {
      return res.status(400).json({ error: ibanCheck.error || 'IBAN country does not match beneficiary country' });
    }
    const bicCheck = validateBic(bic);
    if (!bicCheck.isValid) return res.status(400).json({ error: bicCheck.error });

    const beneficiary = await prisma.beneficiary.create({
      data: {
        ...parsed.data,
        userId: req.auth.userId,
        iban,
        bic,
        verificationStatus: 'FORMAT_VALIDATED',
      },
    });
    return res.status(201).json({ beneficiary });
  }));

  router.post('/transfers/send', authenticate, asyncRoute(async (req, res) => {
    const parsed = validateBody(transferSchema, req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const submittedAmount = new Decimal(parsed.data.amount.toString());
    const requestedAmount = roundAmount(submittedAmount, parsed.data.sourceCurrency);
    if (!requestedAmount.equals(submittedAmount)) {
      return res.status(400).json({
        error: `Amount must have no more than ${currencyPrecision[parsed.data.sourceCurrency]} decimal places`,
      });
    }
    const requestKey = idempotencyKey(req);
    if (!requestKey) return res.status(400).json({ error: 'X-Idempotency-Key header is required' });
    const reference = scopedReference('XFER', req.auth.userId, requestKey);
    const replay = await prisma.walletActivity.findUnique({ where: { reference } });
    if (replay) {
      return res.json({
        activity: replay,
        transfer: await prisma.transfer.findFirst({ where: { userId: req.auth.userId, transactionId: replay.transactionId } }),
        replay: true,
      });
    }

    const user = await prisma.user.findUnique({ where: { id: req.auth.userId } });
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.kycStatus !== 'APPROVED') {
      return res.status(403).json({ error: 'Approved KYC is required before sending money', kycStatus: user.kycStatus });
    }
    if (!(await bcrypt.compare(parsed.data.pin, user.pinHash))) {
      if (!pinRateLimiter.consume(`pin:${user.id}`)) {
        return res.status(429).json({ error: 'Too many incorrect PIN attempts; try again later' });
      }
      return res.status(401).json({ error: 'Incorrect transfer PIN' });
    }
    const beneficiary = await prisma.beneficiary.findFirst({
      where: { id: parsed.data.beneficiaryId, userId: user.id },
    });
    if (!beneficiary) return res.status(404).json({ error: 'Beneficiary not found' });
    if (!['FORMAT_VALIDATED', 'VERIFIED'].includes(beneficiary.verificationStatus)) {
      return res.status(409).json({ error: 'Beneficiary bank details must be format-validated before transfer' });
    }

    const sourceCurrency = parsed.data.sourceCurrency;
    const targetCurrency = beneficiary.country === 'AE' ? 'AED' : 'SAR';
    if (sourceCurrency !== 'PKR') {
      return res.status(400).json({ error: 'UAE and Saudi payout transfers currently require a PKR wallet' });
    }
    const corridorCode = `PK_${beneficiary.country}`;
    const corridor = CORRIDOR_CONFIGURATIONS[corridorCode];
    if (!corridor || corridor.targetCurrency !== targetCurrency) {
      return res.status(400).json({ error: 'Selected source wallet does not support this payout corridor' });
    }
    const persistedQuote = await prisma.fxQuote.findFirst({
      where: { quoteId: parsed.data.quoteId, userId: user.id },
    });
    if (!persistedQuote) return res.status(404).json({ error: 'FX quote not found for this customer' });
    if (persistedQuote.state !== 'ACTIVE') {
      return res.status(409).json({ error: 'FX quote has already been consumed or is unavailable' });
    }
    if (persistedQuote.expiresAt <= new Date()) {
      await prisma.fxQuote.updateMany({
        where: { quoteId: persistedQuote.quoteId, state: 'ACTIVE', expiresAt: { lte: new Date() } },
        data: { state: 'EXPIRED' },
      });
      return res.status(422).json({ error: 'FX quote has expired; request a new quote' });
    }

    const quote = {
      quoteId: persistedQuote.quoteId,
      corridorCode: persistedQuote.corridorCode,
      sourceCurrency: persistedQuote.sourceCurrency,
      targetCurrency: persistedQuote.targetCurrency,
      instructedAmount: persistedQuote.instructedAmount,
      settlementAmount: persistedQuote.settlementAmount,
      clientRate: persistedQuote.clientRate,
      spreadRevenueAmount: persistedQuote.spreadRevenue,
      expiresAt: persistedQuote.expiresAt.toISOString(),
    };
    if (quote.corridorCode !== corridorCode
      || !quote.instructedAmount.equals(requestedAmount)
      || quote.sourceCurrency !== sourceCurrency
      || quote.targetCurrency !== targetCurrency) {
      return res.status(400).json({ error: 'FX quote does not match the transfer details' });
    }

    let payment;
    try {
      payment = await orchestrator.processPayment({
        corridorCode,
        instructedAmount: requestedAmount,
        instructedCurrency: sourceCurrency,
        targetCurrency,
        senderBic: sourceCurrency === 'PKR' ? 'MEZNBPKK' : sourceCurrency === 'AED' ? 'FABAEADU' : 'RJHIBSRI',
        senderIban: sourceCurrency === 'PKR' ? 'PK67MEZN0000001123456701' : beneficiary.iban,
        senderName: user.fullName,
        receiverBic: beneficiary.bic,
        receiverIban: beneficiary.iban,
        receiverName: beneficiary.fullName,
        remittanceInformation: parsed.data.purpose,
        quoteId: quote.quoteId,
      }, scopedReference('XFER', user.id, requestKey), {
        postLedger: false,
        useIdempotency: false,
        fxQuote: quote,
      });
    } catch (error) {
      return res.status(422).json({ error: error.message });
    }
    if (!payment.success) {
      return res.status(403).json({ error: payment.message, payment });
    }

    const minimumFee = new Decimal(sourceCurrency === 'PKR' ? '100' : '2');
    const feeAmount = roundAmount(
      Decimal.max(minimumFee, requestedAmount.mul('0.005')),
      sourceCurrency
    );
    const debitAmount = roundAmount(requestedAmount.plus(feeAmount), sourceCurrency);
    const sourceRate = baseUsdRates[sourceCurrency];
    const targetRate = baseUsdRates[targetCurrency];
    const payoutAmount = roundAmount(new Decimal(quote.settlementAmount.toString()), targetCurrency);
    const debitBase = round4(debitAmount.mul(sourceRate));
    const payoutBase = round4(payoutAmount.mul(targetRate));
    const feeBase = round4(feeAmount.mul(sourceRate));
    const fxPosition = debitBase.minus(payoutBase);
    const valuationAdjustment = fxPosition.minus(feeBase);
    if (!fxPosition.isPositive()) {
      return res.status(422).json({ error: 'Quoted payout and fee do not cover the source value' });
    }

    let transfer;
    try {
      transfer = await prisma.$transaction(async tx => {
      const consumedQuote = await tx.fxQuote.updateMany({
        where: {
          quoteId: persistedQuote.quoteId,
          userId: user.id,
          corridorCode,
          sourceCurrency,
          targetCurrency,
          instructedAmount: requestedAmount,
          state: 'ACTIVE',
          expiresAt: { gt: new Date() },
        },
        data: { state: 'CONSUMED', consumedAt: new Date() },
      });
      if (consumedQuote.count !== 1) {
        throw new Error('FX_QUOTE_UNAVAILABLE');
      }

      const wallet = await tx.wallet.findUnique({
        where: { userId_currency: { userId: user.id, currency: sourceCurrency } },
      });
      if (!wallet) throw new Error(`No ${sourceCurrency} wallet exists for this user`);
      const debitResult = await tx.wallet.updateMany({
        where: { id: wallet.id, balance: { gte: debitAmount } },
        data: { balance: { decrement: debitAmount } },
      });
      if (debitResult.count !== 1) throw new Error(`Insufficient ${sourceCurrency} wallet balance, including transfer fee`);

      const walletAccount = await tx.account.findUniqueOrThrow({ where: { id: wallet.shadowAccountId } });
      const payoutAccount = await ensurePlatformAccount(
        tx,
        `PAYOUT-NOSTRO-${targetCurrency}`,
        `${targetCurrency} payout settlement nostro`,
        targetCurrency,
        beneficiary.bic,
        new Decimal('2500000')
      );
      const positionAccount = await ensurePlatformAccount(
        tx,
        'FX-TRANSFER-POSITION-CLEARING',
        'USD transfer FX position clearing',
        'USD',
        null,
        new Decimal(0),
        'LIABILITY'
      );
      const revenueAccount = await ensurePlatformAccount(
        tx,
        'FX-TRANSFER-FEE-REVENUE',
        'Wallet transfer disclosed fee revenue',
        'USD',
        null,
        new Decimal(0),
        'REVENUE'
      );
      const valuationGainAccount = await ensurePlatformAccount(
        tx,
        'FX-TRANSFER-VALUATION-GAIN',
        'Wallet transfer FX valuation gain',
        'USD',
        null,
        new Decimal(0),
        'REVENUE'
      );
      const valuationLossAccount = await ensurePlatformAccount(
        tx,
        'FX-TRANSFER-VALUATION-LOSS',
        'Wallet transfer FX valuation loss',
        'USD',
        null,
        new Decimal(0),
        'EXPENSE'
      );
      const fxEntries = [
        { accountId: walletAccount.id, direction: 'DEBIT', amount: debitAmount, currency: sourceCurrency, exchangeRate: sourceRate, description: 'Wallet principal and disclosed fee' },
        { accountId: positionAccount.id, direction: 'CREDIT', amount: debitBase, currency: 'USD', exchangeRate: new Decimal(1), description: 'Source value posted to USD FX position' },
        { accountId: positionAccount.id, direction: 'DEBIT', amount: payoutBase, currency: 'USD', exchangeRate: new Decimal(1), description: 'USD FX position applied to destination payout' },
        { accountId: payoutAccount.id, direction: 'CREDIT', amount: payoutAmount, currency: targetCurrency, exchangeRate: targetRate, description: 'Beneficiary bank payout' },
      ];
      if (fxPosition.isPositive()) {
        fxEntries.push({
          accountId: positionAccount.id,
          direction: 'DEBIT',
          amount: fxPosition,
          currency: 'USD',
          exchangeRate: new Decimal(1),
          description: 'Clear residual USD FX position',
        });
      } else if (fxPosition.isNegative()) {
        fxEntries.push({
          accountId: positionAccount.id,
          direction: 'CREDIT',
          amount: fxPosition.abs(),
          currency: 'USD',
          exchangeRate: new Decimal(1),
          description: 'Clear residual USD FX position',
        });
      }
      if (feeBase.isPositive()) {
        fxEntries.push({
          accountId: revenueAccount.id,
          direction: 'CREDIT',
          amount: feeBase,
          currency: 'USD',
          exchangeRate: new Decimal(1),
          description: 'Disclosed transfer fee revenue',
        });
      }
      if (valuationAdjustment.isPositive()) {
        fxEntries.push({
          accountId: valuationGainAccount.id,
          direction: 'CREDIT',
          amount: valuationAdjustment,
          currency: 'USD',
          exchangeRate: new Decimal(1),
          description: 'FX valuation gain after disclosed fee',
        });
      } else if (valuationAdjustment.isNegative()) {
        fxEntries.push({
          accountId: valuationLossAccount.id,
          direction: 'DEBIT',
          amount: valuationAdjustment.abs(),
          currency: 'USD',
          exchangeRate: new Decimal(1),
          description: 'FX valuation loss after disclosed fee',
        });
      }
      const transaction = await postJournal(tx, {
        reference,
        type: 'WALLET_CROSS_BORDER_TRANSFER',
        corridorCode,
        uetr: payment.uetr,
        description: `Wallet payout to ${beneficiary.country}`,
        legs: fxEntries,
      });
      const timeline = [
        { step: 'WALLET_DEBITED', label: 'Wallet debit posted', status: 'COMPLETED', completedAt: new Date().toISOString() },
        { step: 'SANCTIONS_CLEARED', label: 'Sanctions cleared', status: 'COMPLETED', completedAt: new Date().toISOString() },
        { step: 'INSTRUCTION_CREATED', label: 'Payment instruction prepared', status: 'COMPLETED', completedAt: new Date().toISOString() },
        { step: 'FUNDS_RECEIVED', label: 'External settlement', status: 'PENDING' },
      ];
      const simulatedStatusPath = [
        ['INITIATED', 'Demo transfer request received'],
        ['VALIDATING', 'Customer, beneficiary, and sanctions checks completed'],
        ['QUOTED', 'Customer-owned FX quote validated'],
        ['FUNDS_DEBITED', 'Wallet debit and prototype ledger posting committed'],
        ['SIMULATED', 'No bank submission or settlement has been verified'],
      ];
      const statusEvents = simulatedStatusPath.map(([toStatus, reason], index) => {
        const fromStatus = index === 0 ? null : simulatedStatusPath[index - 1][0];
        assertTransferTransition(fromStatus, toStatus);
        return {
          sequenceOrder: index + 1,
          fromStatus,
          toStatus,
          reason: `DEMO_MODE: ${reason}`,
          actorType: 'SYSTEM',
        };
      });
      const savedTransfer = await tx.transfer.create({
        data: {
          userId: user.id,
          walletId: wallet.id,
          beneficiaryId: beneficiary.id,
          transactionId: transaction.id,
          uetr: payment.uetr,
          corridorCode,
          sendAmount: requestedAmount,
          feeAmount,
          sourceCurrency,
          payoutAmount,
          payoutCurrency: targetCurrency,
          exchangeRate: quote.clientRate,
          status: 'SIMULATED',
          purpose: parsed.data.purpose,
          pacs008Xml: payment.pacs008Xml,
          pacs002Xml: payment.pacs002Xml,
          timeline,
          statusEvents: {
            create: statusEvents,
          },
        },
      });
      await tx.fxQuote.update({
        where: { quoteId: persistedQuote.quoteId },
        data: { transferId: savedTransfer.id },
      });
      await tx.walletActivity.create({
        data: {
          userId: user.id,
          walletId: wallet.id,
          transactionId: transaction.id,
          kind: 'TRANSFER',
          status: 'SIMULATED',
          amount: debitAmount,
          currency: sourceCurrency,
          reference,
          description: `Transfer to ${beneficiary.fullName}`,
          details: { feeAmount, feeCurrency: sourceCurrency, payoutAmount: quote.settlementAmount, payoutCurrency: targetCurrency, uetr: payment.uetr },
        },
      });
      return savedTransfer;
      });
    } catch (error) {
      if (error.message === 'FX_QUOTE_UNAVAILABLE') {
        return res.status(409).json({ error: 'FX quote expired or was already consumed' });
      }
      if (error?.code === 'P2002') {
        const replay = await prisma.walletActivity.findUnique({ where: { reference } });
        if (replay) {
          return res.json({
            activity: replay,
            transfer: await prisma.transfer.findFirst({ where: { userId: user.id, transactionId: replay.transactionId } }),
            replay: true,
          });
        }
      }
      if (error.message.startsWith('Insufficient PKR wallet balance')) {
        return res.status(409).json({ error: error.message });
      }
      throw error;
    }
    return res.status(201).json({
      transfer,
      feeAmount,
      feeCurrency: sourceCurrency,
      totalDebited: debitAmount,
      sourceCurrency,
      payoutAmount: quote.settlementAmount,
      payoutCurrency: targetCurrency,
      exchangeRate: quote.clientRate,
      pacs008Xml: payment.pacs008Xml,
      timeline: transfer.timeline,
    });
  }));

  router.use((error, _req, res, _next) => {
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'Identity document must be 8 MB or smaller' });
    }
    if (error.message === 'Upload a JPEG, PNG, or PDF identity document') {
      return res.status(400).json({ error: error.message });
    }
    console.error('[CONSUMER_API_ERROR]', error);
    return res.status(500).json({ error: 'The request could not be completed' });
  });

  return router;
}
