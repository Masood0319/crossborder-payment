// ============================================================================
// Express Route Handlers with Idempotency, HMAC & Zod Validation
// ============================================================================

import { InitiatePaymentSchema, BankCallbackSchema } from './validation.schemas.js';
import { verifyHmacSignature, verifyTimestampWindow } from './security.js';
import { createHash } from 'node:crypto';

const PARTNER_IDEMPOTENCY_RETENTION_DAYS = 90;

function canonicalize(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function requestHash(value) {
  return createHash('sha256').update(canonicalize(value), 'utf8').digest('hex');
}

function sendStoredPartnerResponse(res, record, replay = false) {
  if (replay) res.set('Idempotent-Replay', 'true');
  if (record.status === 'PROCESSING') {
    return res.status(202).json({ status: 'PROCESSING', retryAfterSeconds: 2 });
  }
  return res.status(record.responseStatus).json(record.responseBody);
}

async function findPartnerIdempotency(prisma, partnerId, idempotencyKey, hash, res) {
  const record = await prisma.partnerIdempotency.findUnique({
    where: { partnerId_idempotencyKey: { partnerId, idempotencyKey } },
  });
  if (!record) return null;
  if (record.requestHash !== hash) {
    return res.status(409).json({ error: 'Idempotency key was already used with a different request payload' });
  }
  if (record.expiresAt <= new Date()) {
    return res.status(409).json({ error: 'Idempotency key retention has expired; use a new key' });
  }
  return sendStoredPartnerResponse(res, record, true);
}

export async function handleInitiatePayment(req, res, { orchestrator, rateLimiter, hmacSecret, prisma }) {
  try {
    const clientId = req.headers['x-client-id'];
    const timestamp = req.headers['x-timestamp'];
    const signature = req.headers['x-signature'];
    const idempotencyKey = req.headers['x-idempotency-key'];
    if (typeof clientId !== 'string' || !/^[A-Za-z0-9._-]{1,64}$/.test(clientId)) {
      return res.status(401).json({ error: 'A valid X-Client-Id header is required' });
    }
    if (!timestamp || !verifyTimestampWindow(timestamp)) {
      return res.status(401).json({ error: 'Request timestamp is missing, expired, or outside the replay protection window' });
    }
    if (!verifyHmacSignature({ clientId, timestamp, idempotencyKey, body: req.body }, signature, hmacSecret)) {
      return res.status(401).json({ error: 'Invalid HMAC-SHA256 request signature' });
    }
    if (typeof idempotencyKey !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(idempotencyKey)) {
      return res.status(400).json({ error: 'A valid X-Idempotency-Key header is required' });
    }
    if (rateLimiter && !rateLimiter.consume(clientId)) {
      return res.status(429).json({ error: 'Too Many Requests: Rate limit exceeded' });
    }

    const validationResult = InitiatePaymentSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({
        error: 'Schema validation error',
        details: validationResult.error.errors,
      });
    }

    if (!prisma?.partnerIdempotency || typeof prisma.$transaction !== 'function') {
      return res.status(503).json({ error: 'Durable partner idempotency storage is unavailable' });
    }

    const requestBody = validationResult.data;
    const hash = requestHash(requestBody);
    const existing = await findPartnerIdempotency(prisma, clientId, idempotencyKey, hash, res);
    if (existing) return existing;

    try {
      const response = await prisma.$transaction(async tx => {
        const concurrent = await tx.partnerIdempotency.findUnique({
          where: { partnerId_idempotencyKey: { partnerId: clientId, idempotencyKey } },
        });
        if (concurrent) {
          if (concurrent.requestHash !== hash) {
            return { conflict: true };
          }
          return { existing: concurrent };
        }

        const now = new Date();
        await tx.partnerIdempotency.create({
          data: {
            partnerId: clientId,
            idempotencyKey,
            requestHash: hash,
            status: 'PROCESSING',
            expiresAt: new Date(now.getTime() + PARTNER_IDEMPOTENCY_RETENTION_DAYS * 24 * 60 * 60 * 1000),
          },
        });

        let responseStatus;
        let responseBody;
        let status;
        try {
          const result = await orchestrator.processPayment(
            requestBody,
            `${clientId}:${idempotencyKey}`,
            { postLedger: false, useIdempotency: false }
          );
          responseStatus = result.success ? 200 : 403;
          responseBody = JSON.parse(JSON.stringify(result));
          status = result.success ? 'COMPLETED' : 'FAILED';
        } catch {
          responseStatus = 422;
          responseBody = {
            success: false,
            executionMode: 'SIMULATED',
            settlementVerified: false,
            message: 'Payment instruction could not be processed',
          };
          status = 'FAILED';
        }

        const completed = await tx.partnerIdempotency.update({
          where: { partnerId_idempotencyKey: { partnerId: clientId, idempotencyKey } },
          data: { status, responseStatus, responseBody },
        });
        return { completed };
      });

      if (response.conflict) {
        return res.status(409).json({ error: 'Idempotency key was already used with a different request payload' });
      }
      if (response.existing) {
        if (response.existing.requestHash !== hash) {
          return res.status(409).json({ error: 'Idempotency key was already used with a different request payload' });
        }
        if (response.existing.expiresAt <= new Date()) {
          return res.status(409).json({ error: 'Idempotency key retention has expired; use a new key' });
        }
        return sendStoredPartnerResponse(res, response.existing, true);
      }
      return sendStoredPartnerResponse(res, response.completed);
    } catch (error) {
      if (error?.code === 'P2002') {
        const raced = await findPartnerIdempotency(prisma, clientId, idempotencyKey, hash, res);
        if (raced) return raced;
      }
      throw error;
    }
  } catch (err) {
    console.error('[PAYMENT_INITIATION_ERROR]', err);
    return res.status(500).json({ error: 'Payment request could not be completed' });
  }
}

export async function handleBankCallback(req, res, { prisma, hmacSecret, source }) {
  try {
    if (!hmacSecret || hmacSecret.length < 32) {
      return res.status(503).json({ error: 'Callback authentication is not configured' });
    }
    const timestamp = req.headers['x-timestamp'];
    const signature = req.headers['x-signature'];
    if (!timestamp || !verifyTimestampWindow(timestamp)) {
      return res.status(401).json({ error: 'Callback timestamp is missing, expired, or outside the replay protection window' });
    }
    if (!verifyHmacSignature({ timestamp, body: req.body }, signature, hmacSecret)) {
      return res.status(401).json({ error: 'Invalid HMAC signature on bank webhook' });
    }
    if (!prisma?.callbackInbox || !prisma?.transaction) {
      return res.status(503).json({ error: 'Durable callback storage is unavailable' });
    }

    const validationResult = BankCallbackSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({
        error: 'Invalid bank callback payload',
        details: validationResult.error.errors,
      });
    }

    const callback = validationResult.data;
    const payloadHash = createHash('sha256').update(JSON.stringify(callback)).digest('hex');
    const existing = await prisma.callbackInbox.findUnique({
      where: { source_messageId: { source, messageId: callback.messageId } },
    });
    if (existing) {
      if (existing.payloadHash !== payloadHash) {
        return res.status(409).json({ error: 'Callback message ID was already used with a different payload' });
      }
      return res.status(200).json({
        received: true,
        persisted: true,
        duplicate: true,
        source,
        callbackId: existing.id,
        settlementVerified: false,
      });
    }

    const transaction = await prisma.transaction.findUnique({
      where: { uetr: callback.originalUetr },
      select: { id: true },
    });
    let stored;
    let duplicate = false;
    try {
      stored = await prisma.callbackInbox.create({
        data: {
          source,
          messageId: callback.messageId,
          originalUetr: callback.originalUetr,
          transactionStatus: callback.transactionStatus,
          callbackTimestamp: new Date(timestamp),
          payloadHash,
          payload: callback,
          processingStatus: source === 'SIMULATED' ? 'IGNORED_SIMULATED' : 'RECEIVED',
          transactionId: transaction?.id,
        },
      });
    } catch (error) {
      if (error?.code !== 'P2002') throw error;
      const raced = await prisma.callbackInbox.findUnique({
        where: { source_messageId: { source, messageId: callback.messageId } },
      });
      if (!raced || raced.payloadHash !== payloadHash) {
        return res.status(409).json({ error: 'Callback message ID was already used with a different payload' });
      }
      stored = raced;
      duplicate = true;
    }

    return res.status(200).json({
      received: true,
      persisted: true,
      duplicate,
      source,
      callbackId: stored.id,
      ...(source === 'SIMULATED' ? { executionMode: 'SIMULATED' } : {}),
      uetr: callback.originalUetr,
      status: callback.transactionStatus,
      settlementVerified: false,
      receivedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[BANK_CALLBACK_ERROR]', err);
    return res.status(500).json({ error: 'Callback could not be persisted' });
  }
}
