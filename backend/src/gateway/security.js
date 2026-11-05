// ============================================================================
// Security Infrastructure: HMAC-SHA256, Replay Protection, Token Bucket Rate Limiting
// ============================================================================

import { createHmac, timingSafeEqual } from 'node:crypto';

export function generateHmacSignature(payload, secret) {
  const stringified = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return createHmac('sha256', secret).update(stringified, 'utf-8').digest('hex');
}

export function verifyHmacSignature(payload, signature, secret) {
  if (!signature || !secret) return false;
  try {
    const computed = generateHmacSignature(payload, secret);
    const signatureBuffer = Buffer.from(signature, 'hex');
    const computedBuffer = Buffer.from(computed, 'hex');
    if (signatureBuffer.length !== computedBuffer.length) return false;
    return timingSafeEqual(signatureBuffer, computedBuffer);
  } catch {
    return false;
  }
}

export function verifyTimestampWindow(timestampHeader, maxDriftSeconds = 300) {
  const headerTime = new Date(timestampHeader).getTime();
  if (isNaN(headerTime)) return false;
  const now = Date.now();
  const deltaSeconds = Math.abs(now - headerTime) / 1000;
  return deltaSeconds <= maxDriftSeconds;
}

export class TokenBucketRateLimiter {
  constructor(capacity = 100, refillRatePerSecond = 20) {
    this.capacity = capacity;
    this.refillRatePerSecond = refillRatePerSecond;
    this.buckets = new Map();
  }

  consume(key, tokens = 1) {
    const now = Date.now();
    let bucket = this.buckets.get(key);

    if (!bucket) {
      bucket = { tokens: this.capacity, lastRefill: now };
      this.buckets.set(key, bucket);
    } else {
      const elapsedSeconds = (now - bucket.lastRefill) / 1000;
      bucket.tokens = Math.min(this.capacity, bucket.tokens + elapsedSeconds * this.refillRatePerSecond);
      bucket.lastRefill = now;
    }

    if (bucket.tokens >= tokens) {
      bucket.tokens -= tokens;
      return true;
    }
    return false;
  }
}

export class IdempotencyManager {
  constructor(ttlSeconds = 86400) {
    this.cache = new Map();
    this.ttlMs = ttlSeconds * 1000;
  }

  has(key) {
    const item = this.cache.get(key);
    if (!item) return false;
    if (Date.now() > item.expiresAt) {
      this.cache.delete(key);
      return false;
    }
    return true;
  }

  get(key) {
    if (!this.has(key)) return null;
    return this.cache.get(key).response;
  }

  set(key, response) {
    this.cache.set(key, {
      response,
      expiresAt: Date.now() + this.ttlMs,
    });
  }
}
