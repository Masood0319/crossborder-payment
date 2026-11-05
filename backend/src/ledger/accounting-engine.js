// ============================================================================
// ACID-Compliant Double-Entry Accounting Engine (JavaScript ES Modules)
// Strict zero-sum balance invariant, row-level locking patterns & trial balance
// ============================================================================

import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';

const Decimal = Prisma.Decimal;
const BASE_CURRENCY = 'USD';
const CURRENCY_MINOR_UNITS = {
  // The USD reporting ledger retains the schema's four-decimal base precision.
  USD: 4,
  PKR: 2,
  AED: 2,
  SAR: 2,
  EUR: 2,
};

function decimal(value, description) {
  try {
    const result = new Decimal(value.toString());
    if (!result.isFinite()) throw new Error();
    return result;
  } catch {
    throw new Error(`${description} must be a finite decimal value`);
  }
}

function roundCurrency(value, currency) {
  const scale = CURRENCY_MINOR_UNITS[currency];
  if (scale === undefined) throw new Error(`Unsupported ledger currency ${currency}`);
  return decimal(value, 'Amount').toDecimalPlaces(scale, Decimal.ROUND_HALF_UP);
}

function roundBase(value) {
  return decimal(value, 'Base amount').toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
}

function oppositeDirection(direction) {
  return direction === 'DEBIT' ? 'CREDIT' : 'DEBIT';
}

export class AccountingEngine {
  constructor() {
    this.accounts = new Map();
    this.transactions = new Map();
    this.entries = [];
    this.nostroVostroPools = new Map();
    this.activeLocks = new Set();

    // Reporting amounts are valued in USD using USD per one unit of currency.
    this.usdBaseRates = {
      USD: new Decimal('1'),
      PKR: new Decimal('0.003578'),
      AED: new Decimal('0.272294'),
      SAR: new Decimal('0.266667'),
      EUR: new Decimal('1.08'),
    };

    this.initializeStandardChartOfAccounts();
  }

  initializeStandardChartOfAccounts() {
    // 1. ASSET Accounts (Nostro balances held with partner clearing banks)
    this.createAccount({
      accountNumber: '1100-MEEZAN-PKR-NOSTRO',
      name: 'Meezan Bank Pakistan Settlement Nostro',
      type: 'ASSET',
      currency: 'PKR',
      bankIdentifier: 'MEZNBPKK',
      iban: 'PK67MEZN0000001123456701',
      initialBalance: 50_000_000.0, // 50M PKR
    });

    this.createAccount({
      accountNumber: '1200-FAB-AED-NOSTRO',
      name: 'First Abu Dhabi Bank UAE Settlement Nostro',
      type: 'ASSET',
      currency: 'AED',
      bankIdentifier: 'FABAEADU',
      iban: 'AE070331234567890123456',
      initialBalance: 2_500_000.0, // 2.5M AED
    });

    this.createAccount({
      accountNumber: '1300-RAJHI-SAR-NOSTRO',
      name: 'Al Rajhi Bank Saudi Settlement Nostro',
      type: 'ASSET',
      currency: 'SAR',
      bankIdentifier: 'RJHIBSRI',
      iban: 'SA3180123456789012345678',
      initialBalance: 2_500_000.0, // 2.5M SAR
    });

    // 2. LIABILITY Accounts (Clearing Transit Obligations)
    this.createAccount({
      accountNumber: '2100-INWARD-TRANSIT-PKR',
      name: 'Raast Inward Clearing Transit Payable',
      type: 'LIABILITY',
      currency: 'PKR',
      initialBalance: 0.0,
    });

    this.createAccount({
      accountNumber: '2200-OUTWARD-TRANSIT-AED',
      name: 'AANI UAE Outward Payout Clearing Payable',
      type: 'LIABILITY',
      currency: 'AED',
      initialBalance: 0.0,
    });

    this.createAccount({
      accountNumber: '2300-OUTWARD-TRANSIT-SAR',
      name: 'SARIE Saudi Outward Payout Clearing Payable',
      type: 'LIABILITY',
      currency: 'SAR',
      initialBalance: 0.0,
    });

    // 3. EQUITY Accounts (Partner Liquidity Capital Reserves)
    const totalOpeningAssetUsd = roundBase(
      new Decimal('50000000').mul(this.usdBaseRates.PKR)
        .plus(new Decimal('2500000').mul(this.usdBaseRates.AED))
        .plus(new Decimal('2500000').mul(this.usdBaseRates.SAR))
    );

    this.createAccount({
      accountNumber: '3100-CAPITAL-RESERVE',
      name: 'Partner Liquidity Capital Reserves',
      type: 'EQUITY',
      currency: 'USD',
      initialBalance: totalOpeningAssetUsd,
    });

    // 4. REVENUE Accounts (FX Spread Margin Income)
    this.createAccount({
      accountNumber: '4100-FX-SPREAD-REVENUE',
      name: 'Cross-Border FX Margin Spread Revenue',
      type: 'REVENUE',
      currency: 'USD',
      initialBalance: 0.0,
    });

    this.createAccount({
      accountNumber: '4200-FX-POSITION-CLEARING',
      name: 'USD FX Position Clearing',
      type: 'LIABILITY',
      currency: BASE_CURRENCY,
      initialBalance: 0,
    });

    this.createAccount({
      accountNumber: '4201-FX-VALUATION-GAIN',
      name: 'FX Valuation Gain',
      type: 'REVENUE',
      currency: BASE_CURRENCY,
      initialBalance: 0,
    });

    this.createAccount({
      accountNumber: '5200-FX-VALUATION-LOSS',
      name: 'FX Valuation Loss',
      type: 'EXPENSE',
      currency: BASE_CURRENCY,
      initialBalance: 0,
    });

    // 5. Initialize Nostro / Vostro Shadow Ledger monitoring
    this.initializeNostroPool('MEZNBPKK', 'Meezan Bank Pakistan', 'PKR', 50_000_000, 10_000_000, 100_000_000, 50_000_000);
    this.initializeNostroPool('FABAEADU', 'First Abu Dhabi Bank UAE', 'AED', 2_500_000, 500_000, 5_000_000, 2_500_000);
    this.initializeNostroPool('RJHIBSRI', 'Al Rajhi Bank Saudi Arabia', 'SAR', 2_500_000, 500_000, 5_000_000, 2_500_000);
  }

  createAccount(params) {
    const id = randomUUID();
    const account = {
      id,
      accountNumber: params.accountNumber,
      name: params.name,
      type: params.type,
      currency: params.currency,
      bankIdentifier: params.bankIdentifier,
      iban: params.iban,
      currentBalance: roundCurrency(params.initialBalance || 0, params.currency),
      isActive: true,
    };
    this.accounts.set(account.accountNumber, account);
    return account;
  }

  getAccount(accountNumber) {
    const acct = this.accounts.get(accountNumber);
    if (!acct) {
      throw new Error(`Ledger account ${accountNumber} not found`);
    }
    return acct;
  }

  getAllAccounts() {
    return Array.from(this.accounts.values());
  }

  initializeNostroPool(bankCode, bankName, currency, currentBalance, minThreshold, maxThreshold, targetBalance) {
    const account = Array.from(this.accounts.values()).find(
      a => a.bankIdentifier === bankCode && a.currency === currency
    );
    if (!account) return;

    const record = {
      id: randomUUID(),
      accountId: account.id,
      bankCode,
      bankName,
      partnerRole: bankCode === 'MEZNBPKK' ? 'ORIGINATING_INSTITUTION' : 'CREDITOR_INSTITUTION',
      currency,
      currentBalance,
      reservedBalance: 0,
      availableBalance: currentBalance,
      minimumThreshold: minThreshold,
      maximumThreshold: maxThreshold,
      targetBalance,
      lastReconciledAt: new Date().toISOString(),
    };
    this.nostroVostroPools.set(`${bankCode}:${currency}`, record);
  }

  getNostroPools() {
    return Array.from(this.nostroVostroPools.values());
  }

  async acquireLock(resourceKey) {
    if (this.activeLocks.has(resourceKey)) {
      let retries = 50;
      while (this.activeLocks.has(resourceKey) && retries > 0) {
        await new Promise(resolve => setTimeout(resolve, 5));
        retries--;
      }
      if (this.activeLocks.has(resourceKey)) {
        throw new Error(`Lock acquisition timeout for pool resource ${resourceKey}`);
      }
    }
    this.activeLocks.add(resourceKey);
    return () => {
      this.activeLocks.delete(resourceKey);
    };
  }

  postTransaction(params) {
    if (!params.reference || typeof params.reference !== 'string') {
      throw new Error('Ledger transaction reference is required');
    }
    if (this.transactions.has(params.reference)) {
      throw new Error(`Ledger transaction reference ${params.reference} has already been posted`);
    }
    if (!Array.isArray(params.entries) || params.entries.length < 2) {
      const count = Array.isArray(params.entries) ? params.entries.length : 0;
      throw new Error(`Double-entry requires at least 2 legs; received ${count}`);
    }

    const txId = randomUUID();
    const resolvedEntries = [];
    let totalDebitBase = new Decimal(0);
    let totalCreditBase = new Decimal(0);
    const balanceChanges = new Map();

    params.entries.forEach((leg, index) => {
      const amount = roundCurrency(leg.amount, leg.currency);
      if (!amount.isPositive()) {
        throw new Error(`Entry leg ${index + 1} has non-positive amount ${amount.toString()}`);
      }
      if (leg.direction !== 'DEBIT' && leg.direction !== 'CREDIT') {
        throw new Error(`Entry leg ${index + 1} has invalid direction ${leg.direction}`);
      }

      const account = this.getAccount(leg.accountNumber);
      if (!account.isActive) {
        throw new Error(`Ledger account ${leg.accountNumber} is inactive`);
      }
      if (account.currency !== leg.currency) {
        throw new Error(
          `Currency mismatch for account ${leg.accountNumber}: expected ${account.currency}, received ${leg.currency}`
        );
      }

      const exchangeRate = decimal(
        leg.exchangeRate ?? this.usdBaseRates[leg.currency],
        `Exchange rate for ${leg.currency}`
      );
      if (!exchangeRate.isPositive()) {
        throw new Error(`Exchange rate for ${leg.currency} must be positive`);
      }
      const baseAmount = roundBase(amount.mul(exchangeRate));

      if (leg.direction === 'DEBIT') {
        totalDebitBase = totalDebitBase.plus(baseAmount);
      } else {
        totalCreditBase = totalCreditBase.plus(baseAmount);
      }

      const debitIncreasesBalance = account.type === 'ASSET' || account.type === 'EXPENSE';
      const increasesBalance = leg.direction === 'DEBIT'
        ? debitIncreasesBalance
        : !debitIncreasesBalance;
      const signedAmount = increasesBalance ? amount : amount.negated();
      balanceChanges.set(
        account.accountNumber,
        (balanceChanges.get(account.accountNumber) || new Decimal(0)).plus(signedAmount)
      );
      resolvedEntries.push({
        id: randomUUID(),
        transactionId: txId,
        accountId: account.id,
        direction: leg.direction,
        amount,
        currency: leg.currency,
        exchangeRate,
        baseAmount,
        sequenceOrder: index + 1,
        description: leg.description,
      });
    });

    if (!totalDebitBase.equals(totalCreditBase)) {
      throw new Error(
        `Double-entry invariant violated! Debits (${totalDebitBase.toString()} ${BASE_CURRENCY}) != Credits (${totalCreditBase.toString()} ${BASE_CURRENCY})`
      );
    }

    for (const [accountNumber, change] of balanceChanges) {
      const account = this.getAccount(accountNumber);
      const newBalance = account.currentBalance.plus(change);
      if (newBalance.isNegative()) {
        throw new Error(`Insufficient ledger balance for account ${accountNumber}`);
      }
    }

    for (const [accountNumber, change] of balanceChanges) {
      const account = this.getAccount(accountNumber);
      account.currentBalance = account.currentBalance.plus(change);
    }

    const txRecord = {
      id: txId,
      reference: params.reference,
      type: params.type,
      corridorCode: params.corridorCode,
      status: 'POSTED',
      totalDebitBase,
      totalCreditBase,
      currency: BASE_CURRENCY,
      description: params.description,
      entries: resolvedEntries,
      postedAt: new Date().toISOString(),
      reversesTransactionId: params.reversesTransactionId || null,
      reversalReason: params.reversalReason || null,
    };

    this.transactions.set(txRecord.reference, txRecord);
    this.entries.push(...resolvedEntries);
    return txRecord;
  }

  reverseTransaction(reference, reason) {
    const original = this.transactions.get(reference);
    if (!original || original.status !== 'POSTED') {
      throw new Error(`Posted ledger transaction ${reference} was not found or is already reversed`);
    }
    if (typeof reason !== 'string' || reason.trim().length === 0) {
      throw new Error('A reversal reason is required');
    }

    const reversal = this.postTransaction({
      reference: `REV-${original.reference}`,
      type: 'REVERSAL',
      corridorCode: original.corridorCode,
      description: `Reversal of ${original.reference}: ${reason.trim()}`,
      reversesTransactionId: original.id,
      reversalReason: reason.trim(),
      entries: original.entries.map(entry => ({
        accountNumber: this.getAllAccounts().find(account => account.id === entry.accountId).accountNumber,
        direction: oppositeDirection(entry.direction),
        amount: entry.amount,
        currency: entry.currency,
        exchangeRate: entry.exchangeRate,
        description: `Reversal: ${entry.description || original.reference}`,
      })),
    });
    original.status = 'REVERSED';
    return reversal;
  }

  generateTrialBalance() {
    let totalDebitBase = new Decimal(0);
    let totalCreditBase = new Decimal(0);

    const accountSummaries = Array.from(this.accounts.values()).map(account => {
      const rate = this.usdBaseRates[account.currency];
      const baseBalance = roundBase(account.currentBalance.mul(rate));

      if (account.type === 'ASSET' || account.type === 'EXPENSE') {
        totalDebitBase = totalDebitBase.plus(baseBalance);
        return {
          accountNumber: account.accountNumber,
          name: account.name,
          currency: account.currency,
          rawBalance: account.currentBalance.toString(),
          debitBaseUsd: baseBalance,
          creditBaseUsd: new Decimal(0),
        };
      } else {
        totalCreditBase = totalCreditBase.plus(baseBalance);
        return {
          accountNumber: account.accountNumber,
          name: account.name,
          currency: account.currency,
          rawBalance: account.currentBalance.toString(),
          debitBaseUsd: new Decimal(0),
          creditBaseUsd: baseBalance,
        };
      }
    });

    const delta = totalDebitBase.minus(totalCreditBase).abs();
    const isBalanced = delta.isZero();

    return {
      timestamp: new Date().toISOString(),
      isBalanced,
      totalDebitBaseUsd: totalDebitBase.toFixed(4),
      totalCreditBaseUsd: totalCreditBase.toFixed(4),
      discrepancyUsd: delta.toFixed(4),
      accounts: accountSummaries,
    };
  }

  executeCrossBorderSettlementJournal(quote, senderBankBic, receiverBankBic, uetr) {
    const sourceAmount = roundCurrency(quote.instructedAmount, quote.sourceCurrency);
    const payoutAmount = roundCurrency(quote.settlementAmount, quote.targetCurrency);
    const corridorCurrencies = quote.corridorCode.split('_');
    const corridorCurrencyCodes = { PK: 'PKR', AE: 'AED', SA: 'SAR' };
    if (corridorCurrencies.length !== 2
      || corridorCurrencyCodes[corridorCurrencies[0]] !== quote.sourceCurrency
      || corridorCurrencyCodes[corridorCurrencies[1]] !== quote.targetCurrency) {
      throw new Error('FX quote currencies do not match the settlement corridor');
    }

    const nostroAccounts = {
      PKR: '1100-MEEZAN-PKR-NOSTRO',
      AED: '1200-FAB-AED-NOSTRO',
      SAR: '1300-RAJHI-SAR-NOSTRO',
    };
    const sourceAccount = nostroAccounts[quote.sourceCurrency];
    const destinationAccount = nostroAccounts[quote.targetCurrency];
    const sourceRate = this.usdBaseRates[quote.sourceCurrency];
    const targetRate = this.usdBaseRates[quote.targetCurrency];
    if (!sourceAccount || !destinationAccount || !sourceRate || !targetRate) {
      throw new Error(`Unsupported settlement currency pair ${quote.sourceCurrency}/${quote.targetCurrency}`);
    }

    const sourceBaseValue = roundBase(sourceAmount.mul(sourceRate));
    const payoutBaseValue = roundBase(payoutAmount.mul(targetRate));
    const spreadRevenue = roundBase(
      decimal(quote.spreadRevenueAmount, 'FX spread revenue').mul(targetRate)
    );
    const fxPosition = sourceBaseValue.minus(payoutBaseValue);
    const valuationAdjustment = fxPosition.minus(spreadRevenue);
    const entries = [
      {
        accountNumber: sourceAccount,
        direction: 'DEBIT',
        amount: sourceAmount,
        currency: quote.sourceCurrency,
        exchangeRate: sourceRate,
        description: `Funds received via ${senderBankBic}`,
      },
      {
        accountNumber: '4200-FX-POSITION-CLEARING',
        direction: 'CREDIT',
        amount: sourceBaseValue,
        currency: BASE_CURRENCY,
        description: 'Source value posted to USD FX position',
      },
      {
        accountNumber: '4200-FX-POSITION-CLEARING',
        direction: 'DEBIT',
        amount: payoutBaseValue,
        currency: BASE_CURRENCY,
        description: 'USD FX position applied to destination payout',
      },
      {
        accountNumber: destinationAccount,
        direction: 'CREDIT',
        amount: payoutAmount,
        currency: quote.targetCurrency,
        exchangeRate: targetRate,
        description: `Payout disbursed via ${receiverBankBic}`,
      },
    ];

    if (fxPosition.isPositive()) {
      entries.push({
        accountNumber: '4200-FX-POSITION-CLEARING',
        direction: 'DEBIT',
        amount: fxPosition,
        currency: BASE_CURRENCY,
        description: 'Clear residual USD FX position',
      });
    } else if (fxPosition.isNegative()) {
      entries.push({
        accountNumber: '4200-FX-POSITION-CLEARING',
        direction: 'CREDIT',
        amount: fxPosition.abs(),
        currency: BASE_CURRENCY,
        description: 'Clear residual USD FX position',
      });
    }

    if (spreadRevenue.isPositive()) {
      entries.push({
        accountNumber: '4100-FX-SPREAD-REVENUE',
        direction: 'CREDIT',
        amount: spreadRevenue,
        currency: BASE_CURRENCY,
        description: `Recognized FX spread for ${quote.corridorCode}`,
      });
    }
    if (valuationAdjustment.isPositive()) {
      entries.push({
        accountNumber: '4201-FX-VALUATION-GAIN',
        direction: 'CREDIT',
        amount: valuationAdjustment,
        currency: BASE_CURRENCY,
        description: 'Recognized residual FX valuation gain',
      });
    } else if (valuationAdjustment.isNegative()) {
      entries.push({
        accountNumber: '5200-FX-VALUATION-LOSS',
        direction: 'DEBIT',
        amount: valuationAdjustment.abs(),
        currency: BASE_CURRENCY,
        description: 'Recognized residual FX valuation loss',
      });
    }

    return this.postTransaction({
      reference: `TX-${uetr.substring(0, 8)}`,
      type: 'CROSS_BORDER_PAYOUT',
      corridorCode: quote.corridorCode,
      description: `Simulated cross-border settlement: ${sourceAmount.toString()} ${quote.sourceCurrency} -> ${payoutAmount.toString()} ${quote.targetCurrency}`,
      entries,
    });
  }
}
