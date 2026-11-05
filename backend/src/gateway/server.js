// ============================================================================
// Production Express API Gateway Server Entry Point (JavaScript ES Modules)
// ============================================================================

import express from 'express';
import cors from 'cors';
import { PaymentOrchestrator } from './orchestrator.js';
import { TokenBucketRateLimiter } from './security.js';
import { handleInitiatePayment, handleBankCallback } from './routes.js';
import { createConsumerRouter } from './consumer-routes.js';
import { createTreasuryRouter } from './treasury-routes.js';
import { PrismaClient } from '@prisma/client';
import { createKycDocumentEncryptionService } from './kyc-encryption.js';

export function createServer(options = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(cors({
    origin: [
      process.env.FRONTEND_ORIGIN || 'http://localhost:3000',
      process.env.CONSUMER_FRONTEND_ORIGIN || 'http://localhost:3001',
    ],
  }));
  app.use(express.json({ limit: '1mb' }));
  app.use((_req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'no-referrer');
    res.set('X-Frame-Options', 'DENY');
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

  app.get('/health', (req, res) => {
    res.json({
      status: 'UP',
      service: 'crossborder-payment-orchestrator',
      timestamp: new Date().toISOString(),
    });
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
