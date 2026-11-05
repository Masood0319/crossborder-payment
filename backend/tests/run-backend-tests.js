// ============================================================================
// Comprehensive Cross-Border Settlement Engine Test Suite (JavaScript ES Modules)
// ============================================================================

import express from 'express';
import { validateIban, validateBic, validateUetr } from '../src/iso20022/validator.js';
import { serializePacs008, serializePacs002 } from '../src/iso20022/serializer.js';
import { parsePacs008, parsePacs002 } from '../src/iso20022/parser.js';
import { screenTransactionParties, screenEntity, calculateEnsembleMatch } from '../src/sanctions/screening-engine.js';
import { FxTreasuryEngine } from '../src/treasury/fx-engine.js';
import { MOCK_INTERBANK_RATES } from '../src/treasury/corridor-rates.js';
import { AccountingEngine } from '../src/ledger/accounting-engine.js';
import { generateHmacSignature, verifyHmacSignature, verifyTimestampWindow } from '../src/gateway/security.js';
import { PaymentOrchestrator } from '../src/gateway/orchestrator.js';
import { assertTransferTransition } from '../src/gateway/transfer-lifecycle.js';
import { createServer } from '../src/gateway/server.js';
import { createTreasuryRouter } from '../src/gateway/treasury-routes.js';
import { handleInitiatePayment, handleBankCallback } from '../src/gateway/routes.js';
import { InitiatePaymentSchema, BankCallbackSchema } from '../src/gateway/validation.schemas.js';

process.env.JWT_SECRET ||= 'test-only-jwt-secret-at-least-32-characters';
process.env.HMAC_SECRET ||= 'test-only-hmac-secret-at-least-32-characters';

let totalTests = 0;
let passedTests = 0;

function assert(condition, testName, extraInfo = '') {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  [PASS] ${testName} ${extraInfo ? `(${extraInfo})` : ''}`);
  } else {
    console.error(`  [FAIL] ${testName} ${extraInfo ? `(${extraInfo})` : ''}`);
    process.exitCode = 1;
  }
}

async function runTestSuite() {
  console.log('================================================================');
  console.log('  CROSS-BORDER PAYMENT ENGINE - FULL VERIFICATION SUITE');
  console.log('================================================================\n');

  // --------------------------------------------------------------------------
  // TEST SUITE 1: ISO 13616 IBAN & ISO 9362 BIC VALIDATION
  // --------------------------------------------------------------------------
  console.log('--- MODULE 1 & 2: ISO Validation & Schema ---');

  const validPkIban = 'PK67MEZN0000001123456701';
  const ibanCheckPk = validateIban(validPkIban);
  assert(ibanCheckPk.isValid, 'Valid Pakistani IBAN verification (PK67MEZN...)', ibanCheckPk.error);

  const invalidIban = 'PK67MEZN0000001123456799';
  const invalidCheck = validateIban(invalidIban);
  assert(!invalidCheck.isValid, 'Invalid IBAN checksum correctly rejected');

  const validBic = validateBic('MEZNBPKK');
  assert(validBic.isValid, 'Valid BIC 8-char MEZNBPKK');

  const validBic11 = validateBic('FABAEADXXXX');
  assert(validBic11.isValid, 'Valid BIC 11-char FABAEADXXXX');

  const invalidBic = validateBic('INVALID_BIC_CODE');
  assert(!invalidBic.isValid, 'Malformed BIC format correctly rejected');

  const validUuid = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';
  assert(validateUetr(validUuid).isValid, 'Valid RFC 4122 UUIDv4 as UETR');
  assert(!validateUetr('non-uuid-string').isValid, 'Malformed UETR correctly rejected');

  // --------------------------------------------------------------------------
  // TEST SUITE 2: ISO 20022 XML SERIALIZER & PARSER ROUNDTRIP
  // --------------------------------------------------------------------------
  console.log('\n--- MODULE 2: ISO 20022 Serializer & Parser Roundtrip ---');

  const pacs008Sample = serializePacs008({
    messageId: 'MSG-TEST-001',
    settlementRail: 'AANI',
    endToEndId: 'E2E-TEST-001',
    uetr: validUuid,
    corridorCode: 'PK_AE',
    instructedAmount: 100000,
    instructedCurrency: 'PKR',
    settlementAmount: 1303.90,
    settlementCurrency: 'AED',
    exchangeRate: 0.013039,
    debtorName: 'Tariq Mehmood',
    debtorIban: validPkIban,
    debtorBic: 'MEZNBPKK',
    creditorName: 'Gulf Star Trading LLC',
    creditorIban: 'AE070331234567890123456',
    creditorBic: 'FABAEADU',
    remittanceInformation: 'Invoice 8891 Settlement',
  });

  assert(pacs008Sample.includes('<FIToFICstmrCdtTrf>'), 'pacs.008 XML includes FIToFICstmrCdtTrf root');
  assert(pacs008Sample.includes('IntrBkSttlmAmt Ccy="AED"'), 'Settlement amount uses the destination currency');
  assert(pacs008Sample.includes('<IntrBkSttlmAmt Ccy="AED">1303.90</IntrBkSttlmAmt>'), 'ISO settlement amount uses target minor-unit precision');
  assert(pacs008Sample.includes(`<UETR>${validUuid}</UETR>`), 'UETR included in pacs.008 XML');

  const parsedPacs008 = parsePacs008(pacs008Sample);
  assert(parsedPacs008.messageId === 'MSG-TEST-001', 'Parsed MsgId matches serialized message');
  assert(parsedPacs008.settlementAmount.equals('1303.90'), 'Parsed settlement amount preserves decimal precision');
  assert(parsedPacs008.instructedAmount.equals('100000'), 'Parsed instructed amount preserves decimal precision');
  assert(parsedPacs008.debtorName === 'Tariq Mehmood', 'Parsed debtor name matches');
  assert(parsedPacs008.creditorIban === 'AE070331234567890123456', 'Parsed creditor IBAN matches');

  const pacs002Sample = serializePacs002({
    messageId: 'MSGRPT-TEST-001',
    originalMessageId: 'MSG-TEST-001',
    originalEndToEndId: 'E2E-TEST-001',
    originalUetr: validUuid,
    transactionStatus: 'ACCP',
    clearingSystemRef: 'AANI-99218271',
    instructingBic: 'MEZNBPKK',
    instructedBic: 'FABAEADU',
  });

  const parsedPacs002 = parsePacs002(pacs002Sample);
  assert(parsedPacs002.transactionStatus === 'ACCP', 'pacs.002 parsed status is ACCP (Accepted)');

  // --------------------------------------------------------------------------
  // TEST SUITE 3: SANCTIONS SCREENING PIPELINE
  // --------------------------------------------------------------------------
  console.log('\n--- MODULE 3: AML & Sanctions Screening Fuzzy Pipeline ---');

  const innocentScreening = screenTransactionParties(validUuid, 'Muhammad Usman Khan', 'Dubai Retail Mart LLC');
  assert(innocentScreening.isCleared, 'Innocent individual is CLEARED');
  assert(innocentScreening.decision === 'APPROVE', 'Decision is APPROVE');
  assert(innocentScreening.totalExecutionTimeMs < 40, 'Screening pipeline latency budget < 40ms', `${innocentScreening.totalExecutionTimeMs}ms`);

  const sanctionedScreening = screenTransactionParties(validUuid, 'Tareq Hashemi', 'Dubai Retail Mart LLC');
  assert(!sanctionedScreening.isCleared, 'Sanctioned entity "Tareq Hashemi" is NOT cleared');
  assert(sanctionedScreening.decision === 'REJECT_BLOCKED', 'Decision is REJECT_BLOCKED');
  assert(sanctionedScreening.combinedRiskScore >= 85, 'Confidence score >= 85%', `${sanctionedScreening.combinedRiskScore}%`);

  const tokenSortMatch = calculateEnsembleMatch('Hashemi Tariq', 'Tariq Al-Hashemi');
  assert(tokenSortMatch.confidencePercent >= 80, 'Token-inverted name detected by Token Sort algorithm', `${tokenSortMatch.confidencePercent}%`);
  assert(screenEntity('Tariq Hashem', 'SENDER').status === 'POTENTIAL_MATCH', 'Fuzzy partial-name matches require review rather than automatic blocking');
  assert(screenEntity('Muhammad Khan', 'SENDER').status === 'CLEARED', 'A common-name overlap does not trigger a sanctions match');
  let invalidScreeningNameRejected = false;
  try {
    screenEntity('   ', 'SENDER');
  } catch {
    invalidScreeningNameRejected = true;
  }
  assert(invalidScreeningNameRejected, 'Sanctions screening fails closed for missing or blank names');

  const transferPath = [
    [null, 'INITIATED'],
    ['INITIATED', 'VALIDATING'],
    ['VALIDATING', 'QUOTED'],
    ['QUOTED', 'FUNDS_DEBITED'],
    ['FUNDS_DEBITED', 'SIMULATED'],
  ];
  let validTransferPathAccepted = true;
  for (const [fromStatus, toStatus] of transferPath) {
    try {
      assertTransferTransition(fromStatus, toStatus);
    } catch {
      validTransferPathAccepted = false;
    }
  }
  assert(validTransferPathAccepted, 'Valid simulated transfer lifecycle is accepted');
  let invalidTransferTransitionRejected = false;
  try {
    assertTransferTransition('SUBMITTED', 'SETTLED');
  } catch {
    invalidTransferTransitionRejected = true;
  }
  assert(invalidTransferTransitionRejected, 'Transfer lifecycle rejects skipped acceptance and settlement states');
  let validReversalTransitionAccepted = true;
  try {
    assertTransferTransition('SIMULATED', 'REVERSED');
  } catch {
    validReversalTransitionAccepted = false;
  }
  assert(validReversalTransitionAccepted, 'A simulated transfer may enter its audited reversal state');
  let simulatedSettlementRejected = false;
  try {
    assertTransferTransition('SIMULATED', 'SETTLED');
  } catch {
    simulatedSettlementRejected = true;
  }
  assert(simulatedSettlementRejected, 'Simulated transfers cannot transition to verified settlement');

  // --------------------------------------------------------------------------
  // TEST SUITE 4: REAL-TIME FX & TREASURY ENGINE
  // --------------------------------------------------------------------------
  console.log('\n--- MODULE 4: Real-Time FX Rate Lock & Treasury Engine ---');

  const fxEngine = new FxTreasuryEngine();
  const quote = fxEngine.generateQuote({
    corridorCode: 'PK_AE',
    sourceCurrency: 'PKR',
    targetCurrency: 'AED',
    instructedAmount: 500000,
    tier: 'COMMERCIAL',
  });

  assert(Boolean(quote.quoteId), 'Generated quote ID');
  assert(quote.clientRate > 0, 'Client rate computed', quote.clientRate);
  assert(quote.settlementAmount > 0, 'Settlement amount computed', `${quote.settlementAmount} AED`);
  assert(quote.ttlSecondsRemaining > 0, 'TTL seconds remaining positive', `${quote.ttlSecondsRemaining}s`);

  const consumedQuote = fxEngine.verifyAndConsumeQuote(quote.quoteId);
  assert(consumedQuote.quoteId === quote.quoteId, 'Fresh quote successfully verified and consumed');
  assert(consumedQuote.state === 'CONSUMED', 'Consumed quote records its single-use state');
  let quoteReplayRejected = false;
  try {
    fxEngine.verifyAndConsumeQuote(quote.quoteId);
  } catch {
    quoteReplayRejected = true;
  }
  assert(quoteReplayRejected, 'Consumed FX quotes cannot be replayed');

  let invalidPairRejected = false;
  try {
    fxEngine.generateQuote({
      corridorCode: 'PK_AE',
      sourceCurrency: 'PKR',
      targetCurrency: 'SAR',
      instructedAmount: 1000,
      tier: 'COMMERCIAL',
    });
  } catch {
    invalidPairRejected = true;
  }
  assert(invalidPairRejected, 'FX quote rejects a currency pair inconsistent with its corridor');

  let invalidAmountRejected = false;
  try {
    fxEngine.generateQuote({
      corridorCode: 'PK_AE',
      sourceCurrency: 'PKR',
      targetCurrency: 'AED',
      instructedAmount: '-1',
      tier: 'COMMERCIAL',
    });
  } catch {
    invalidAmountRejected = true;
  }
  assert(invalidAmountRejected, 'FX quote rejects negative and malformed amount values');

  let excessivePrecisionRejected = false;
  try {
    fxEngine.generateQuote({
      corridorCode: 'PK_AE',
      sourceCurrency: 'PKR',
      targetCurrency: 'AED',
      instructedAmount: '1000.005',
      tier: 'COMMERCIAL',
    });
  } catch {
    excessivePrecisionRejected = true;
  }
  assert(excessivePrecisionRejected, 'FX quote rejects source amounts beyond currency minor-unit precision');

  let untrustedTierRejected = false;
  try {
    fxEngine.generateQuote({
      corridorCode: 'PK_AE',
      sourceCurrency: 'PKR',
      targetCurrency: 'AED',
      instructedAmount: 1000,
      tier: 'CLIENT_SUPPLIED_TIER',
    });
  } catch {
    untrustedTierRejected = true;
  }
  assert(untrustedTierRejected, 'FX engine rejects unknown pricing tiers');

  const staleTimestamp = MOCK_INTERBANK_RATES['PKR/AED'].timestamp;
  MOCK_INTERBANK_RATES['PKR/AED'].timestamp = '2000-01-01T00:00:00.000Z';
  let staleRateRejected = false;
  try {
    fxEngine.generateQuote({
      corridorCode: 'PK_AE',
      sourceCurrency: 'PKR',
      targetCurrency: 'AED',
      instructedAmount: 1000,
      tier: 'COMMERCIAL',
    });
  } catch {
    staleRateRejected = true;
  } finally {
    MOCK_INTERBANK_RATES['PKR/AED'].timestamp = staleTimestamp;
  }
  assert(staleRateRejected, 'FX quote refuses stale market observations');

  const concurrentQuote = fxEngine.generateQuote({
    corridorCode: 'PK_AE',
    sourceCurrency: 'PKR',
    targetCurrency: 'AED',
    instructedAmount: 1000,
    tier: 'COMMERCIAL',
  });
  const consumeResults = await Promise.allSettled([
    Promise.resolve().then(() => fxEngine.verifyAndConsumeQuote(concurrentQuote.quoteId)),
    Promise.resolve().then(() => fxEngine.verifyAndConsumeQuote(concurrentQuote.quoteId)),
  ]);
  assert(
    consumeResults.filter(result => result.status === 'fulfilled').length === 1,
    'Concurrent in-process quote consumption allows only one winner'
  );

  const expiringQuote = fxEngine.generateQuote({
    corridorCode: 'PK_AE',
    sourceCurrency: 'PKR',
    targetCurrency: 'AED',
    instructedAmount: 1000,
    tier: 'COMMERCIAL',
  });
  fxEngine.quotes.get(expiringQuote.quoteId).expiresAt = new Date(Date.now() - 1000).toISOString();
  let expiredQuoteRejected = false;
  try {
    fxEngine.verifyAndConsumeQuote(expiringQuote.quoteId);
  } catch {
    expiredQuoteRejected = true;
  }
  assert(
    expiredQuoteRejected && fxEngine.quotes.get(expiringQuote.quoteId).state === 'EXPIRED',
    'Expired quotes are rejected and marked expired'
  );

  const originalBid = MOCK_INTERBANK_RATES['PKR/AED'].bidRate;
  const originalAsk = MOCK_INTERBANK_RATES['PKR/AED'].askRate;
  MOCK_INTERBANK_RATES['PKR/AED'].bidRate = 0.001;
  MOCK_INTERBANK_RATES['PKR/AED'].askRate = 0.025;
  let abnormalMarketRejected = false;
  try {
    fxEngine.generateQuote({
      corridorCode: 'PK_AE',
      sourceCurrency: 'PKR',
      targetCurrency: 'AED',
      instructedAmount: 1000,
      tier: 'COMMERCIAL',
    });
  } catch {
    abnormalMarketRejected = true;
  } finally {
    MOCK_INTERBANK_RATES['PKR/AED'].bidRate = originalBid;
    MOCK_INTERBANK_RATES['PKR/AED'].askRate = originalAsk;
  }
  assert(abnormalMarketRejected, 'FX quote rejects a market spread beyond configured limits');

  const rateFeed = MOCK_INTERBANK_RATES['PKR/AED'];
  const originalRates = {
    mid: rateFeed.midMarketRate,
    bid: rateFeed.bidRate,
    ask: rateFeed.askRate,
  };
  rateFeed.midMarketRate = 0.015;
  rateFeed.bidRate = 0.01495;
  rateFeed.askRate = 0.01505;
  let abnormalRateDeviationRejected = false;
  try {
    fxEngine.generateQuote({
      corridorCode: 'PK_AE',
      sourceCurrency: 'PKR',
      targetCurrency: 'AED',
      instructedAmount: 1000,
      tier: 'COMMERCIAL',
    });
  } catch {
    abnormalRateDeviationRejected = true;
  } finally {
    rateFeed.midMarketRate = originalRates.mid;
    rateFeed.bidRate = originalRates.bid;
    rateFeed.askRate = originalRates.ask;
  }
  assert(abnormalRateDeviationRejected, 'FX quote rejects a mid-market rate outside the configured reference deviation');

  const mockBalances = [
    { bankCode: 'MEZNBPKK', bankName: 'Meezan Bank', currency: 'PKR', currentBalance: 9000000, reservedBalance: 1000000, minimumThreshold: 10000000, maximumThreshold: 100000000, targetBalance: 50000000 },
  ];
  const alerts = fxEngine.evaluateLiquidityAlerts(mockBalances);
  assert(alerts.length > 0, 'Liquidity pool alert triggered when available < minimum');
  assert(alerts[0].thresholdType === 'BELOW_MINIMUM', 'Alert type is BELOW_MINIMUM');
  assert(alerts[0].rebalanceAmountRequired === '42000000.00', 'Liquidity recommendation preserves currency minor-unit precision');
  assert(alerts[0].recommendedAction.includes('Recommendation only; no funds moved'), 'Liquidity recommendations do not imply execution');

  const liquidityError = pool => {
    try {
      fxEngine.evaluateLiquidityAlerts([pool]);
      return false;
    } catch {
      return true;
    }
  };
  const liquidityPool = overrides => ({
    bankCode: 'MEZNBPKK',
    bankName: 'Meezan Bank',
    currency: 'PKR',
    currentBalance: '10000000.00',
    reservedBalance: '1000000.00',
    minimumThreshold: '10000000.00',
    maximumThreshold: '100000000.00',
    targetBalance: '50000000.00',
    ...overrides,
  });
  const criticalAlerts = fxEngine.evaluateLiquidityAlerts([
    liquidityPool({ currentBalance: '3000000.00', reservedBalance: '0.00' }),
  ]);
  assert(criticalAlerts[0]?.thresholdType === 'CRITICAL_DEPLETION', 'Critical liquidity depletion is identified');

  const excessAlerts = fxEngine.evaluateLiquidityAlerts([
    liquidityPool({ currentBalance: '120000000.00', reservedBalance: '0.00' }),
  ]);
  assert(excessAlerts[0]?.thresholdType === 'ABOVE_MAXIMUM', 'Above-maximum liquidity recommends a surplus sweep');
  assert(excessAlerts[0]?.rebalanceAmountRequired === '70000000.00', 'Surplus amount is calculated using the target balance');

  const roundedAlerts = fxEngine.evaluateLiquidityAlerts([
    liquidityPool({
      currentBalance: '10000000.129',
      reservedBalance: '1000000.004',
      minimumThreshold: '10000000.00',
    }),
  ]);
  assert(roundedAlerts[0]?.availableBalance === '9000000.13', 'PKR liquidity balances round to currency minor units');

  assert(
    liquidityError(liquidityPool({ currentBalance: '100.00', reservedBalance: '101.00' })),
    'Liquidity validation rejects reserved funds above current balance'
  );
  assert(
    liquidityError(liquidityPool({ currentBalance: '-1.00' })),
    'Liquidity validation rejects negative balances'
  );
  assert(
    liquidityError(liquidityPool({ maximumThreshold: '9000000.00' })),
    'Liquidity validation rejects maximum thresholds below minimum'
  );
  assert(
    liquidityError(liquidityPool({ targetBalance: '110000000.00' })),
    'Liquidity validation rejects target balances outside the configured range'
  );
  assert(
    liquidityError(liquidityPool({ bankCode: 'DEUTDEFF' })),
    'Liquidity recommendations reject unconfigured counterparties'
  );

  // --------------------------------------------------------------------------
  // TEST SUITE 5: DOUBLE-ENTRY ACCOUNTING LEDGER
  // --------------------------------------------------------------------------
  console.log('\n--- MODULE 5: Double-Entry Accounting Ledger & Invariant ---');

  const ledger = new AccountingEngine();
  const settlementJournal = ledger.executeCrossBorderSettlementJournal(
    quote,
    'MEZNBPKK',
    'FABAEADU',
    validUuid
  );

  assert(settlementJournal.status === 'POSTED', 'Cross-border settlement journal transaction is strictly balanced');
  assert(settlementJournal.entries.length === 7, 'Seven atomic entry legs recorded in journal');

  const trialBalance = ledger.generateTrialBalance();
  assert(
    trialBalance.isBalanced,
    'Ledger-wide Trial Balance is strictly in equilibrium (Debits == Credits)',
    `Debits: $${trialBalance.totalDebitBaseUsd}, Credits: $${trialBalance.totalCreditBaseUsd}`
  );

  let caughtUnbalancedError = false;
  try {
    ledger.postTransaction({
      reference: 'TX-ILLEGAL-UNBALANCED',
      type: 'PAYMENT',
      description: 'Intentional imbalance test',
      entries: [
        { accountNumber: '1100-MEEZAN-PKR-NOSTRO', direction: 'DEBIT', amount: 100000, currency: 'PKR' },
        { accountNumber: '2100-INWARD-TRANSIT-PKR', direction: 'CREDIT', amount: 50000, currency: 'PKR' },
      ],
    });
  } catch {
    caughtUnbalancedError = true;
  }
  assert(caughtUnbalancedError, 'Double-entry engine immediately rejects unbalanced transaction');

  const spreadRevenueEntry = settlementJournal.entries.find(entry =>
    ledger.getAllAccounts().find(account => account.id === entry.accountId)?.accountNumber === '4100-FX-SPREAD-REVENUE'
  );
  assert(Boolean(spreadRevenueEntry), 'FX spread revenue is posted separately from the clearing position');
  assert(
    ledger.getAccount('4200-FX-POSITION-CLEARING').currentBalance.isZero(),
    'USD FX position clearing account is zero after a completed journal'
  );

  const saQuote = fxEngine.generateQuote({
    corridorCode: 'PK_SA',
    sourceCurrency: 'PKR',
    targetCurrency: 'SAR',
    instructedAmount: 500000,
    tier: 'COMMERCIAL',
  });
  const saLedger = new AccountingEngine();
  const saJournal = saLedger.executeCrossBorderSettlementJournal(
    saQuote,
    'MEZNBPKK',
    'RJHIBSRI',
    'ea0c1e1a-1e9b-4a2d-b921-8c57f2e7fb85'
  );
  assert(
    saJournal.totalDebitBase.equals(saJournal.totalCreditBase),
    'PKR-to-SAR transfer balances using explicit USD FX clearing'
  );

  const postingLedger = new AccountingEngine();
  const roundedJournal = postingLedger.postTransaction({
    reference: 'TX-ROUNDING-TEST',
    type: 'SAME_CURRENCY_TEST',
    corridorCode: 'PKR_PKR',
    entries: [
      { accountNumber: '1100-MEEZAN-PKR-NOSTRO', direction: 'DEBIT', amount: '10.126', currency: 'PKR' },
      { accountNumber: '2100-INWARD-TRANSIT-PKR', direction: 'CREDIT', amount: '10.126', currency: 'PKR' },
    ],
  });
  assert(
    roundedJournal.entries[0].amount.equals('10.13'),
    'Same-currency ledger amounts round to PKR minor units'
  );
  assert(
    roundedJournal.totalDebitBase.equals(roundedJournal.totalCreditBase),
    'Same-currency transfer balances after currency rounding'
  );

  let duplicatePostingRejected = false;
  try {
    postingLedger.postTransaction({
      reference: 'TX-ROUNDING-TEST',
      type: 'SAME_CURRENCY_TEST',
      corridorCode: 'PKR_PKR',
      entries: [
        { accountNumber: '1100-MEEZAN-PKR-NOSTRO', direction: 'DEBIT', amount: '10', currency: 'PKR' },
        { accountNumber: '2100-INWARD-TRANSIT-PKR', direction: 'CREDIT', amount: '10', currency: 'PKR' },
      ],
    });
  } catch {
    duplicatePostingRejected = true;
  }
  assert(duplicatePostingRejected, 'Duplicate ledger references are rejected before posting');

  const rollbackLedger = new AccountingEngine();
  const originalAedBalance = rollbackLedger.getAccount('1200-FAB-AED-NOSTRO').currentBalance;
  let insufficientFundsRejected = false;
  try {
    rollbackLedger.postTransaction({
      reference: 'TX-INSUFFICIENT-TEST',
      type: 'PAYOUT_TEST',
      corridorCode: 'AE_AE',
      entries: [
        { accountNumber: '2200-OUTWARD-TRANSIT-AED', direction: 'DEBIT', amount: '3000000', currency: 'AED' },
        { accountNumber: '1200-FAB-AED-NOSTRO', direction: 'CREDIT', amount: '3000000', currency: 'AED' },
      ],
    });
  } catch {
    insufficientFundsRejected = true;
  }
  assert(insufficientFundsRejected, 'Insufficient account funds reject the journal');
  assert(
    rollbackLedger.entries.length === 0
      && rollbackLedger.getAccount('1200-FAB-AED-NOSTRO').currentBalance.equals(originalAedBalance),
    'Rejected journal leaves entries and account balances unchanged'
  );

  const reversalLedger = new AccountingEngine();
  const originalSourceBalance = reversalLedger.getAccount('1100-MEEZAN-PKR-NOSTRO').currentBalance;
  const reversibleJournal = reversalLedger.executeCrossBorderSettlementJournal(
    quote,
    'MEZNBPKK',
    'FABAEADU',
    'da42f5c2-7dc7-45dc-886e-0b3d7842b80a'
  );
  const reversal = reversalLedger.reverseTransaction(reversibleJournal.reference, 'Test compensating reversal');
  assert(reversalLedger.transactions.get(reversibleJournal.reference).status === 'REVERSED', 'Original journal is marked reversed');
  assert(reversal.reversesTransactionId === reversibleJournal.id, 'Reversal records its original transaction');
  assert(
    reversalLedger.getAccount('1100-MEEZAN-PKR-NOSTRO').currentBalance.equals(originalSourceBalance)
      && reversalLedger.generateTrialBalance().isBalanced,
    'Compensating reversal restores balances and preserves trial balance'
  );

  // --------------------------------------------------------------------------
  // TEST SUITE 6: BANKING GATEWAY & END-TO-END ORCHESTRATOR
  // --------------------------------------------------------------------------
  console.log('\n--- MODULE 6: Banking API Gateway & End-to-End Orchestrator ---');

  const testSecret = 'secret-signing-key-test-32chars!';
  const testPayload = { amount: 10000, currency: 'PKR', uetr: validUuid };
  const hmacSig = generateHmacSignature(testPayload, testSecret);
  assert(verifyHmacSignature(testPayload, hmacSig, testSecret), 'HMAC-SHA256 signature generated and verified');
  assert(!verifyHmacSignature(testPayload, hmacSig, 'wrong-secret'), 'HMAC signature rejects a different secret');
  assert(verifyTimestampWindow(new Date().toISOString()), 'Timestamp replay protection passes for current time');
  let unsignedPaymentStatus = 0;
  const unsignedPaymentResponse = {
    status(code) {
      unsignedPaymentStatus = code;
      return this;
    },
    json() {},
  };
  await handleInitiatePayment(
    { headers: { 'x-client-id': 'test-client' }, body: {} },
    unsignedPaymentResponse,
    {
      orchestrator: { processPayment: async () => { throw new Error('Unsigned request reached payment processing'); } },
      rateLimiter: null,
      hmacSecret: testSecret,
      prisma: {},
    }
  );
  assert(unsignedPaymentStatus === 401, 'Unsigned payment initiation is rejected');
  const signedTimestamp = new Date().toISOString();
  const signedClientId = 'test-client';
  const signedIdempotencyKey = 'IDEMP-TEST-SIGNED-001';
  const signedBody = {};
  const signedPaymentStatus = { value: 0 };
  await handleInitiatePayment(
    {
      headers: {
        'x-client-id': signedClientId,
        'x-timestamp': signedTimestamp,
        'x-idempotency-key': signedIdempotencyKey,
        'x-signature': generateHmacSignature({
          clientId: signedClientId,
          timestamp: signedTimestamp,
          idempotencyKey: signedIdempotencyKey,
          body: signedBody,
        }, testSecret),
      },
      body: signedBody,
    },
    {
      status(code) {
        signedPaymentStatus.value = code;
        return this;
      },
      json() {},
    },
    {
      orchestrator: { processPayment: async () => { throw new Error('Invalid schema reached payment processing'); } },
      rateLimiter: null,
      hmacSecret: testSecret,
      prisma: {},
    }
  );
  assert(signedPaymentStatus.value === 400, 'Signed payment request reaches payload validation');
  const tamperedIdempotencyStatus = { value: 0 };
  await handleInitiatePayment(
    {
      headers: {
        'x-client-id': signedClientId,
        'x-timestamp': signedTimestamp,
        'x-idempotency-key': 'IDEMP-CHANGED-AFTER-SIGNING',
        'x-signature': generateHmacSignature({
          clientId: signedClientId,
          timestamp: signedTimestamp,
          idempotencyKey: signedIdempotencyKey,
          body: signedBody,
        }, testSecret),
      },
      body: signedBody,
    },
    {
      status(code) {
        tamperedIdempotencyStatus.value = code;
        return this;
      },
      json() {},
    },
    {
      orchestrator: { processPayment: async () => { throw new Error('Tampered idempotency key reached payment processing'); } },
      rateLimiter: null,
      hmacSecret: testSecret,
      prisma: {},
    }
  );
  assert(tamperedIdempotencyStatus.value === 401, 'Signed payment request rejects an idempotency key changed after signing');
  const callbackTimestamp = new Date().toISOString();
  const callbackBody = {
    messageId: 'MSGRPT-TEST-001',
    originalEndToEndId: 'E2E-TEST-001',
    originalUetr: validUuid,
    transactionStatus: 'PDNG',
    instructingBic: 'MEZNBPKK',
    instructedBic: 'FABAEADU',
  };
  const callbackResult = { statusCode: 0, body: null };
  const persistedCallbacks = new Map();
  const callbackPrisma = {
    callbackInbox: {
      async findUnique({ where }) {
        return persistedCallbacks.get(`${where.source_messageId.source}:${where.source_messageId.messageId}`) || null;
      },
      async create({ data }) {
        const record = { id: validUuid, ...data };
        persistedCallbacks.set(`${data.source}:${data.messageId}`, record);
        return record;
      },
    },
    transaction: {
      async findUnique() {
        return null;
      },
    },
  };
  const callbackRequest = {
    headers: {
      'x-timestamp': callbackTimestamp,
      'x-signature': generateHmacSignature({ timestamp: callbackTimestamp, body: callbackBody }, testSecret),
    },
    body: callbackBody,
  };
  const callbackResponse = {
    status(code) {
      callbackResult.statusCode = code;
      return this;
    },
    json(body) {
      callbackResult.body = body;
      return this;
    },
  };
  await handleBankCallback(
    callbackRequest,
    callbackResponse,
    { prisma: callbackPrisma, hmacSecret: testSecret, source: 'SIMULATED' }
  );
  assert(callbackResult.statusCode === 200 && callbackResult.body.persisted === true, 'Signed callback is durably persisted');
  assert(callbackResult.body.settlementVerified === false && callbackResult.body.source === 'SIMULATED', 'Callback receipt remains distinct from verified settlement');
  await handleBankCallback(
    callbackRequest,
    callbackResponse,
    { prisma: callbackPrisma, hmacSecret: testSecret, source: 'SIMULATED' }
  );
  assert(callbackResult.statusCode === 200 && callbackResult.body.duplicate === true, 'Duplicate callback delivery is idempotent');

  const orchestrator = new PaymentOrchestrator();
  const paymentRequest = {
    corridorCode: 'PK_AE',
    instructedAmount: 500000,
    instructedCurrency: 'PKR',
    targetCurrency: 'AED',
    senderBic: 'MEZNBPKK',
    senderIban: validPkIban,
    senderName: 'Muhammad Usman Khan',
    receiverBic: 'FABAEADU',
    receiverIban: 'AE070331234567890123456',
    receiverName: 'Fatima Al-Zahra Commercial LLC',
    remittanceInformation: 'Wholesale Fabric Import Settlement',
  };

  const paymentResult = await orchestrator.processPayment(paymentRequest, 'IDEMP-TEST-KEY-001');
  assert(paymentResult.success === true, 'Payment instruction successfully processed through simulation');
  assert(paymentResult.executionMode === 'SIMULATED' && paymentResult.settlementVerified === false, 'Orchestrator never claims a bank settlement');
  assert(paymentResult.isoStatusCode === 'ACCP', 'ISO status code is ACCP');
  assert(Boolean(paymentResult.pacs008Xml), 'pacs.008 XML generated');
  assert(Boolean(paymentResult.pacs002Xml), 'pacs.002 ACCP XML generated');
  assert(paymentResult.clearingSystemRef.startsWith('AANI-'), 'UAE AANI clearing reference issued');
  assert(paymentResult.executionTimeMs < 2000, 'End-to-End Execution SLA under 2 seconds', `${paymentResult.executionTimeMs}ms`);

  const replayResult = await orchestrator.processPayment(paymentRequest, 'IDEMP-TEST-KEY-001');
  assert(replayResult.isIdempotentReplay === true, 'Idempotency returns cached execution without double-charge');

  const sanctionedRequest = {
    ...paymentRequest,
    senderName: 'Tareq Hashemi',
  };
  const blockedResult = await orchestrator.processPayment(sanctionedRequest, 'IDEMP-TEST-KEY-BLOCKED');
  assert(blockedResult.success === false, 'Sanctioned payment held by compliance');
  assert(blockedResult.isoStatusCode === 'RJCT', 'ISO status code is RJCT');
  assert(blockedResult.reasonCode === 'RR04', 'ISO reason code is RR04 (Regulatory freeze)');

  // --------------------------------------------------------------------------
  // TEST SUITE 7: EXPRESS ROUTE ENDPOINTS & ZOD SCHEMAS
  // --------------------------------------------------------------------------
  console.log('\n--- MODULE 7: Express Route Endpoints & Zod Schemas ---');

  const validParse = InitiatePaymentSchema.safeParse(paymentRequest);
  assert(validParse.success, 'Zod InitiatePaymentSchema passes for valid data');

  const invalidParse = InitiatePaymentSchema.safeParse({ ...paymentRequest, instructedAmount: -500, senderIban: 'BAD' });
  assert(!invalidParse.success, 'Zod InitiatePaymentSchema correctly rejects negative amount & bad IBAN');

  const validCallback = BankCallbackSchema.safeParse({
    messageId: 'MSG-CALLBACK-001',
    originalEndToEndId: 'E2E-TEST-991',
    originalUetr: validUuid,
    transactionStatus: 'ACCP',
    instructingBic: 'MEZNBPKK',
    instructedBic: 'FABAEADU',
  });
  assert(validCallback.success, 'Zod BankCallbackSchema passes for valid bank notification');

  const { app } = createServer();
  assert(typeof app === 'function', 'HTTP API Gateway server initializes cleanly');

  const treasuryEvents = [];
  const treasuryPrisma = {
    nostroVostroBalance: {
      findMany: async () => [{
        bankCode: 'MEZNBPKK',
        bankName: 'Meezan Bank',
        currency: 'PKR',
        currentBalance: '9000000.00',
        reservedBalance: '1000000.00',
        availableBalance: '8000000.00',
        minimumThreshold: '10000000.00',
        maximumThreshold: '100000000.00',
        targetBalance: '50000000.00',
      }],
    },
    treasuryAuditEvent: {
      create: async ({ data }) => {
        const event = { id: String(treasuryEvents.length + 1), ...data };
        treasuryEvents.push(event);
        return event;
      },
      createMany: async ({ data }) => {
        treasuryEvents.push(...data);
        return { count: data.length };
      },
      findFirst: async ({ where }) => treasuryEvents.find(event =>
        Object.entries(where).every(([key, value]) => event[key] === value)
      ) || null,
      findMany: async ({ where }) => treasuryEvents.filter(event =>
        event.eventType === where.eventType
        && event.subjectType === where.subjectType
        && where.subjectId.in.includes(event.subjectId)
      ).map(event => ({ subjectId: event.subjectId })),
    },
  };
  const treasuryApp = express();
  treasuryApp.use('/api/treasury', createTreasuryRouter({
    prisma: treasuryPrisma,
    staffTokenVerifier: token => ({
      reviewerId: `staff-${token}`,
      issuer: 'test-issuer',
      roles: token === 'viewer' ? ['TREASURY_VIEWER'] : ['TREASURY_OPERATOR'],
    }),
  }));
  const treasuryServer = treasuryApp.listen(0);
  try {
    const treasuryBaseUrl = `http://127.0.0.1:${treasuryServer.address().port}/api/treasury`;
    const viewerHeaders = { authorization: 'Bearer viewer' };
    const operatorHeaders = { authorization: 'Bearer operator' };
    let response = await fetch(`${treasuryBaseUrl}/liquidity/alerts`, { headers: viewerHeaders });
    const alertResponse = await response.json();
    assert(response.status === 200 && alertResponse.alerts.length === 1,
      'Treasury staff can view liquidity alerts and pool balances');
    assert(alertResponse.corridors.length === 4
      && alertResponse.corridors.every(corridor => corridor.rateProvider === 'STATIC_DEMO'),
    'Treasury overview reports configured corridors and explicitly static demo rates');
    const alertId = alertResponse.alerts[0].alertId;
    assert(alertResponse.alerts[0].acknowledged === false,
      'New treasury alert is initially unacknowledged');

    response = await fetch(`${treasuryBaseUrl}/liquidity/alerts/${alertId}/acknowledge`, {
      method: 'POST',
      headers: viewerHeaders,
    });
    assert(response.status === 403, 'Treasury viewers cannot acknowledge operational alerts');

    response = await fetch(`${treasuryBaseUrl}/liquidity/alerts/${alertId}/acknowledge`, {
      method: 'POST',
      headers: operatorHeaders,
    });
    assert(response.status === 201, 'Treasury operators can acknowledge an observed alert');

    response = await fetch(`${treasuryBaseUrl}/liquidity/alerts`, { headers: viewerHeaders });
    const refreshedAlerts = await response.json();
    assert(refreshedAlerts.alerts[0].alertId === alertId
      && refreshedAlerts.alerts[0].acknowledged === true,
    'Treasury alert acknowledgement persists across refreshes');
  } finally {
    await new Promise((resolve, reject) => treasuryServer.close(error => error ? reject(error) : resolve()));
  }

  // --------------------------------------------------------------------------
  // FINAL RESULTS
  // --------------------------------------------------------------------------
  console.log('\n================================================================');
  console.log(`  VERIFICATION RESULTS: ${passedTests}/${totalTests} TESTS PASSED`);
  console.log('================================================================\n');
}

runTestSuite().catch(err => {
  console.error('Test Suite encountered fatal error:', err);
  process.exit(1);
});
