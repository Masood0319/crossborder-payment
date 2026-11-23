// ============================================================================
// Production Express API Gateway Server Entry Point (JavaScript ES Modules)
// ============================================================================

import express from 'express';
import cors from 'cors';
import { randomUUID } from 'node:crypto';
import { PaymentOrchestrator } from './orchestrator.js';
import { TokenBucketRateLimiter } from './security.js';
import { handleInitiatePayment, handleBankCallback } from './routes.js';
import { createConsumerRouter } from './consumer-routes.js';
import { createTreasuryRouter } from './treasury-routes.js';
import { PrismaClient } from '@prisma/client';
import { createKycDocumentEncryptionService } from './kyc-encryption.js';
import { verifyPrismaReadiness } from './database.js';

const requiredSecretNames = ['HMAC_SECRET', 'BANK_CALLBACK_HMAC_SECRET', 'JWT_SECRET'];

export function validateBackendEnvironment(environment = process.env) {
  if (!environment.DATABASE_URL) {
    throw new Error('DATABASE_URL must be configured before starting the backend');
  }

  let databaseUrl;
  try {
    databaseUrl = new URL(environment.DATABASE_URL);
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL URL');
  }
  if (!['postgres:', 'postgresql:'].includes(databaseUrl.protocol)
    || !databaseUrl.hostname || !databaseUrl.pathname.slice(1)) {
    throw new Error('DATABASE_URL must include a PostgreSQL host and database name');
  }

  const isLocalDatabase = ['localhost', '127.0.0.1', '::1'].includes(databaseUrl.hostname);
  const sslMode = databaseUrl.searchParams.get('sslmode');
  if (!isLocalDatabase && !['require', 'verify-ca', 'verify-full'].includes(sslMode)) {
    throw new Error('DATABASE_URL for a remote database must use sslmode=require, verify-ca, or verify-full');
  }

  for (const name of requiredSecretNames) {
    const value = environment[name];
    if (typeof value !== 'string' || value.length < 32 || /^(change|replace|example|<)/i.test(value)) {
      throw new Error(`${name} must be configured with a non-placeholder value of at least 32 characters`);
    }
  }

  if (environment.LEDGER_ADMIN_KEY !== undefined
    && (environment.LEDGER_ADMIN_KEY.length < 32
      || /^(change|replace|example|<)/i.test(environment.LEDGER_ADMIN_KEY))) {
    throw new Error('LEDGER_ADMIN_KEY must be a non-placeholder value of at least 32 characters');
  }

  const port = Number(environment.PORT || 5001);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error('PORT must be an integer between 0 and 65535');
  }
}

export function createServer(options = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(cors({
    credentials: true,
    origin: [
      process.env.FRONTEND_ORIGIN || 'http://localhost:3000',
      process.env.CONSUMER_FRONTEND_ORIGIN || 'http://localhost:3001',
    ],
  }));
  app.use(express.json({ limit: '1mb' }));
  app.use((req, res, next) => {
    req.correlationId = req.headers['x-correlation-id']
      && typeof req.headers['x-correlation-id'] === 'string'
      && req.headers['x-correlation-id'].length <= 128
      ? req.headers['x-correlation-id']
      : randomUUID();
    res.set('X-Correlation-ID', req.correlationId);
    next();
  });
  app.use((_req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'no-referrer');
    res.set('X-Frame-Options', 'DENY');
    res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
  });

  const orchestrator = options.orchestrator || new PaymentOrchestrator();
  const rateLimiter = options.rateLimiter || new TokenBucketRateLimiter(200, 50);
  const HMAC_SECRET = process.env.HMAC_SECRET;
  if (!HMAC_SECRET || HMAC_SECRET.length < 32) {
    throw new Error('HMAC_SECRET must be configured with at least 32 characters');
  }
  const prisma = options.prisma || new PrismaClient();
  const kycEncryption = options.kycEncryption
    || (process.env.KYC_KEK_KEYS_JSON || process.env.KYC_KEK_ACTIVE_VERSION
      ? createKycDocumentEncryptionService()
      : null);

  const healthResponse = status => ({
    status,
    service: 'crossborder-payment-orchestrator',
    timestamp: new Date().toISOString(),
  });
  app.get('/health/live', (_req, res) => {
    res.json(healthResponse('live'));
  });
  app.get('/health', (_req, res) => {
    res.json(healthResponse('UP'));
  });
  app.get('/health/ready', async (_req, res) => {
    try {
      await verifyPrismaReadiness(prisma);
      return res.json({
        status: 'ready',
        dependencies: { database: 'available' },
        timestamp: new Date().toISOString(),
      });
    } catch {
      return res.status(503).json({
        status: 'not_ready',
        dependencies: { database: 'unavailable' },
        timestamp: new Date().toISOString(),
      });
    }
  });

  app.post('/api/v1/payments/initiate', (req, res) => {
    handleInitiatePayment(req, res, { orchestrator, rateLimiter, hmacSecret: HMAC_SECRET, prisma });
  });

  app.post('/api/v1/webhooks/bank-callback', (req, res) => {
    handleBankCallback(req, res, {
      prisma,
      hmacSecret: process.env.BANK_CALLBACK_HMAC_SECRET,
      source: 'EXTERNAL_UNVERIFIED',
    });
  });

  app.post('/api/v1/webhooks/simulated-callback', (req, res) => {
    handleBankCallback(req, res, {
      prisma,
      hmacSecret: HMAC_SECRET,
      source: 'SIMULATED',
    });
  });

  app.use('/api/v1', createConsumerRouter({
    prisma,
    orchestrator,
    kycEncryption,
    staffTokenVerifier: options.staffTokenVerifier,
  }));

  app.use('/api/treasury', createTreasuryRouter({
    prisma,
    staffTokenVerifier: options.staffTokenVerifier,
  }));

  return { app, orchestrator, prisma };
}
