// ============================================================================
// Sub-2-Second End-to-End Cross-Border Payment Orchestrator (JavaScript ES Modules)
// ============================================================================

import { randomUUID } from 'node:crypto';
import { validateIban, validateBic, validateUetr } from '../iso20022/validator.js';
import { serializePacs008, serializePacs002 } from '../iso20022/serializer.js';
import { screenTransactionParties } from '../sanctions/screening-engine.js';
import { FxTreasuryEngine } from '../treasury/fx-engine.js';
import { AccountingEngine } from '../ledger/accounting-engine.js';
import { IdempotencyManager } from './security.js';

export class PaymentOrchestrator {
  constructor() {
    this.fxEngine = new FxTreasuryEngine();
    this.ledger = new AccountingEngine();
    this.idempotencyManager = new IdempotencyManager();
    this.transactionLogs = new Map();
  }

  async processPayment(payload, idempotencyKey, {
    postLedger = true,
    useIdempotency = true,
    fxQuote = null,
  } = {}) {
    const startTime = performance.now();

    if (useIdempotency && idempotencyKey && this.idempotencyManager.has(idempotencyKey)) {
      return {
        ...this.idempotencyManager.get(idempotencyKey),
        isIdempotentReplay: true,
      };
    }

    const uetr = payload.uetr || randomUUID();
    const endToEndId = payload.endToEndId || `E2E-${Date.now()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
    const messageId = `MSG-${Date.now()}-${uetr.substring(0, 8)}`;

    // 1. ISO 20022 Structural & Checksum Validations
    const senderIbanCheck = validateIban(payload.senderIban);
    if (!senderIbanCheck.isValid) {
      throw new Error(`Sender IBAN validation failed: ${senderIbanCheck.error}`);
    }

    const receiverIbanCheck = validateIban(payload.receiverIban);
    if (!receiverIbanCheck.isValid) {
      throw new Error(`Receiver IBAN validation failed: ${receiverIbanCheck.error}`);
    }

    const senderBicCheck = validateBic(payload.senderBic);
    if (!senderBicCheck.isValid) {
      throw new Error(`Sender BIC validation failed: ${senderBicCheck.error}`);
    }

    const receiverBicCheck = validateBic(payload.receiverBic);
    if (!receiverBicCheck.isValid) {
      throw new Error(`Receiver BIC validation failed: ${receiverBicCheck.error}`);
    }

    validateUetr(uetr);

    // 2. Real-Time Sanctions Screening (< 40ms)
    const screening = screenTransactionParties(uetr, payload.senderName, payload.receiverName);
    if (!screening.isCleared) {
      const rjctPacs002 = serializePacs002({
        messageId: `MSGRPT-${Date.now()}`,
        originalMessageId: messageId,
        originalEndToEndId: endToEndId,
        originalUetr: uetr,
        transactionStatus: 'RJCT',
        statusReasonCode: 'RR04',
        statusReasonNarrative: 'Regulatory Compliance Freeze: Sanctions Watchlist Hit',
        clearingSystemRef: endToEndId,
        instructingBic: payload.senderBic,
        instructedBic: payload.receiverBic,
      });

      const failureResponse = {
        success: false,
        executionMode: 'SIMULATED',
        settlementVerified: false,
        uetr,
        endToEndId,
        isoStatusCode: 'RJCT',
        reasonCode: 'RR04',
        message: 'Payment rejected by sanctions and AML compliance engine',
        screeningMatch: screening,
        pacs002Xml: rjctPacs002,
        executionTimeMs: Math.round(performance.now() - startTime),
      };

      if (useIdempotency && idempotencyKey) {
        this.idempotencyManager.set(idempotencyKey, failureResponse);
      }
      return failureResponse;
    }

    // 3. Guaranteed FX Quote Locking
    let quote = fxQuote;
    if (quote) {
      if (quote.quoteId !== payload.quoteId
        || quote.corridorCode !== payload.corridorCode
        || quote.sourceCurrency !== payload.instructedCurrency
        || quote.targetCurrency !== payload.targetCurrency) {
        throw new Error('Persisted FX quote does not match the payment instruction');
      }
    } else if (payload.quoteId) {
      quote = this.fxEngine.verifyAndConsumeQuote(payload.quoteId);
    } else {
      quote = this.fxEngine.generateQuote({
        corridorCode: payload.corridorCode,
        sourceCurrency: payload.instructedCurrency,
        targetCurrency: payload.targetCurrency,
        instructedAmount: payload.instructedAmount,
        tier: 'COMMERCIAL',
      });
    }

    // 4. ISO 20022 pacs.008 Canonical Message Serialization
    const settlementRail = payload.corridorCode.endsWith('_AE')
      ? 'AANI'
      : payload.corridorCode.endsWith('_SA')
      ? 'SARIE'
      : 'RAAST';

    const pacs008Xml = serializePacs008({
      messageId,
      settlementRail,
      endToEndId,
      uetr,
      clearingSystemRef: endToEndId,
      corridorCode: payload.corridorCode,
      instructedAmount: quote.instructedAmount,
      instructedCurrency: quote.sourceCurrency,
      settlementAmount: quote.settlementAmount,
      settlementCurrency: quote.targetCurrency,
      exchangeRate: quote.clientRate,
      debtorName: payload.senderName,
      debtorIban: payload.senderIban,
      debtorBic: payload.senderBic,
      creditorName: payload.receiverName,
      creditorIban: payload.receiverIban,
      creditorBic: payload.receiverBic,
      remittanceInformation: payload.remittanceInformation,
    });

    // 5. ACID Double-Entry Accounting Shadow Ledger Update
    const journalTransaction = postLedger
      ? this.ledger.executeCrossBorderSettlementJournal(
          quote,
          payload.senderBic,
          payload.receiverBic,
          uetr
        )
      : null;

    // 6. Generate pacs.002 ACCP Status Report
    const clearingSystemRef = `${settlementRail}-${Date.now().toString().slice(-8)}`;
    const pacs002Xml = serializePacs002({
      messageId: `MSGRPT-${Date.now()}`,
      originalMessageId: messageId,
      originalEndToEndId: endToEndId,
      originalUetr: uetr,
      transactionStatus: 'ACCP',
      clearingSystemRef,
      instructingBic: payload.senderBic,
      instructedBic: payload.receiverBic,
    });

    const executionTimeMs = Math.round(performance.now() - startTime);

    const successResponse = {
      success: true,
      executionMode: 'SIMULATED',
      settlementVerified: false,
      uetr,
      endToEndId,
      clearingSystemRef,
      isoStatusCode: 'ACCP',
      corridorCode: payload.corridorCode,
      instructedAmount: quote.instructedAmount,
      instructedCurrency: quote.sourceCurrency,
      settlementAmount: quote.settlementAmount,
      settlementCurrency: quote.targetCurrency,
      appliedExchangeRate: quote.clientRate,
      journalTransactionId: journalTransaction?.id || null,
      pacs008Xml,
      pacs002Xml,
      executionTimeMs,
      timestamp: new Date().toISOString(),
    };

    if (useIdempotency && idempotencyKey) {
      this.idempotencyManager.set(idempotencyKey, successResponse);
    }

    this.transactionLogs.set(uetr, successResponse);
    return successResponse;
  }
}
