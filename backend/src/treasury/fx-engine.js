// ============================================================================
// Real-Time FX Rate Lock & Treasury Rebalancing Engine (JavaScript ES Modules)
// ============================================================================

import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { CORRIDOR_CONFIGURATIONS, MOCK_INTERBANK_RATES } from './corridor-rates.js';
import { validateBic } from '../iso20022/validator.js';

const Decimal = Prisma.Decimal;
const currencyPrecision = { PKR: 2, AED: 2, SAR: 2, USD: 2 };

function positiveConfigNumber(name, fallback) {
  const value = Number(process.env[name] || fallback);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive finite number`);
  }
  return value;
}

function nonnegativeConfigDecimal(name, fallback) {
  let value;
  try {
    value = new Decimal(process.env[name] || fallback);
  } catch {
    throw new Error(`${name} must be a finite decimal value`);
  }
  if (!value.isFinite() || value.isNegative()) {
    throw new Error(`${name} must be a nonnegative finite decimal value`);
  }
  return value;
}

const MAX_RATE_AGE_MS = positiveConfigNumber('FX_MAX_RATE_AGE_SECONDS', 300) * 1000;
const MAX_MARKET_SPREAD_BPS = nonnegativeConfigDecimal('FX_MAX_MARKET_SPREAD_BPS', '500');
const MAX_MARKET_RATE_DEVIATION_BPS = nonnegativeConfigDecimal('FX_MAX_MARKET_RATE_DEVIATION_BPS', '1000');
const MAX_CLIENT_DEVIATION_BPS = nonnegativeConfigDecimal('FX_MAX_CLIENT_DEVIATION_BPS', '1000');

function toDecimal(value, description) {
  try {
    const result = new Decimal(value.toString());
    if (!result.isFinite()) throw new Error();
    return result;
  } catch {
    throw new Error(`${description} must be a finite decimal value`);
  }
}

function currencyRound(value, currency) {
  const precision = currencyPrecision[currency];
  if (precision === undefined) throw new Error(`Unsupported currency ${currency}`);
  return toDecimal(value, 'Amount').toDecimalPlaces(precision, Decimal.ROUND_HALF_UP);
}

export class FxTreasuryEngine {
  constructor() {
    this.quotes = new Map();
  }

  generateQuote(req) {
    const config = CORRIDOR_CONFIGURATIONS[req.corridorCode];
    if (!config) {
      throw new Error(`Corridor ${req.corridorCode} is not supported`);
    }

    if (req.sourceCurrency !== config.sourceCurrency || req.targetCurrency !== config.targetCurrency) {
      throw new Error(`Currency pair does not match corridor ${req.corridorCode}`);
    }

    const instructedAmount = currencyRound(req.instructedAmount, req.sourceCurrency);
    if (!instructedAmount.isPositive()) {
      throw new Error('Transfer amount must be positive');
    }
    if (!instructedAmount.equals(toDecimal(req.instructedAmount, 'Transfer amount'))) {
      throw new Error(`Transfer amount must have no more than ${currencyPrecision[req.sourceCurrency]} decimal places`);
    }
    if (instructedAmount.lessThan(config.minTransferAmount)) {
      throw new Error(
        `Amount ${instructedAmount.toString()} is below corridor minimum ${config.minTransferAmount} ${config.sourceCurrency}`
      );
    }

    if (instructedAmount.greaterThan(config.maxTransferAmount)) {
      throw new Error(
        `Amount ${instructedAmount.toString()} exceeds corridor maximum ${config.maxTransferAmount} ${config.sourceCurrency}`
      );
    }

    const trustedTierDiscounts = { RETAIL: 0, COMMERCIAL: 10, INSTITUTIONAL: 20 };
    if (!Object.hasOwn(trustedTierDiscounts, req.tier)) {
      throw new Error('A valid server-assigned pricing tier is required');
    }

    const pairKey = `${req.sourceCurrency}/${req.targetCurrency}`;
    const rateFeed = MOCK_INTERBANK_RATES[pairKey];
    if (!rateFeed) {
      throw new Error(`Market rate feed unavailable for currency pair ${pairKey}`);
    }

    const now = new Date();
    const rateObservedAt = new Date(rateFeed.timestamp);
    if (!Number.isFinite(rateObservedAt.getTime())
      || rateObservedAt.getTime() > now.getTime() + 5000
      || now.getTime() - rateObservedAt.getTime() > MAX_RATE_AGE_MS) {
      throw new Error(`Market rate for ${pairKey} is stale or has an invalid observation time`);
    }
    const midMarketRate = toDecimal(rateFeed.midMarketRate, 'Mid-market rate');
    const referenceMidMarketRate = toDecimal(rateFeed.referenceMidMarketRate, 'Reference mid-market rate');
    const bidRate = toDecimal(rateFeed.bidRate, 'Bid rate');
    const askRate = toDecimal(rateFeed.askRate, 'Ask rate');
    if (!midMarketRate.isPositive() || !referenceMidMarketRate.isPositive()
      || !bidRate.isPositive() || !askRate.isPositive()
      || bidRate.greaterThan(midMarketRate) || askRate.lessThan(midMarketRate) || bidRate.greaterThan(askRate)) {
      throw new Error(`Market rate feed for ${pairKey} is invalid`);
    }
    const marketRateDeviationBps = midMarketRate.minus(referenceMidMarketRate).abs()
      .mul(10000)
      .div(referenceMidMarketRate);
    if (marketRateDeviationBps.greaterThan(MAX_MARKET_RATE_DEVIATION_BPS)) {
      throw new Error(`Market rate for ${pairKey} deviates beyond the configured reference limit`);
    }
    const marketSpreadBps = askRate.minus(bidRate).mul(10000).div(midMarketRate);
    if (marketSpreadBps.greaterThan(MAX_MARKET_SPREAD_BPS)) {
      throw new Error(`Market rate spread for ${pairKey} exceeds the configured deviation limit`);
    }

    const tierSpreadDiscountBps = trustedTierDiscounts[req.tier];
    const netSpreadBps = Math.max(10, config.baseSpreadBps - tierSpreadDiscountBps);
    const totalDeductionBps = netSpreadBps + config.volatilityBufferBps;
    if (new Decimal(totalDeductionBps).greaterThan(MAX_CLIENT_DEVIATION_BPS)) {
      throw new Error(`Client pricing deviation for ${pairKey} exceeds the configured limit`);
    }

    const clientRate = midMarketRate
      .mul(new Decimal(10000 - totalDeductionBps))
      .div(10000)
      .toDecimalPlaces(6, Decimal.ROUND_HALF_UP);
    if (!clientRate.isPositive()) throw new Error(`Client rate for ${pairKey} is invalid`);
    const inverseRate = new Decimal(1).div(clientRate).toDecimalPlaces(6, Decimal.ROUND_HALF_UP);
    const settlementAmount = currencyRound(instructedAmount.mul(clientRate), req.targetCurrency);
    const midMarketValue = currencyRound(instructedAmount.mul(midMarketRate), req.targetCurrency);
    const spreadRevenue = midMarketValue.minus(settlementAmount);
    const expiresAt = new Date(now.getTime() + config.quoteTtlSeconds * 1000);

    const quote = {
      quoteId: randomUUID(),
      corridorCode: req.corridorCode,
      sourceCurrency: req.sourceCurrency,
      targetCurrency: req.targetCurrency,
      instructedAmount,
      settlementAmount,
      midMarketRate,
      spreadBps: netSpreadBps,
      volatilityBufferBps: config.volatilityBufferBps,
      clientRate,
      inverseRate,
      spreadRevenueAmount: spreadRevenue,
      rateProvider: 'STATIC_DEMO',
      rateObservedAt: rateObservedAt.toISOString(),
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      ttlSecondsRemaining: config.quoteTtlSeconds,
      isExpired: false,
      state: 'ACTIVE',
      consumedAt: null,
    };

    this.quotes.set(quote.quoteId, quote);
    return quote;
  }

  verifyAndConsumeQuote(quoteId) {
    const quote = this.quotes.get(quoteId);
    if (!quote) {
      throw new Error(`FX Quote ${quoteId} not found or expired`);
    }
    if (quote.state !== 'ACTIVE') {
      throw new Error(`FX Quote ${quoteId} is not available for consumption`);
    }

    const nowMs = Date.now();
    const expiryMs = new Date(quote.expiresAt).getTime();

    if (nowMs >= expiryMs) {
      quote.isExpired = true;
      quote.ttlSecondsRemaining = 0;
      quote.state = 'EXPIRED';
      throw new Error(`FX Quote ${quoteId} has expired. Expiration: ${quote.expiresAt}`);
    }

    quote.ttlSecondsRemaining = Math.max(0, Math.floor((expiryMs - nowMs) / 1000));
    quote.state = 'CONSUMED';
    quote.consumedAt = new Date(nowMs).toISOString();
    return quote;
  }

  evaluateLiquidityAlerts(nostroBalances) {
    if (!Array.isArray(nostroBalances)) {
      throw new Error('Nostro balances must be provided as an array');
    }

    const alerts = [];

    for (const pool of nostroBalances) {
      if (!pool || typeof pool.bankCode !== 'string' || !validateBic(pool.bankCode).isValid
        || typeof pool.bankName !== 'string' || !pool.bankName.trim()) {
        throw new Error('Each liquidity pool must include a valid bank code and bank name');
      }

      const currentBalance = currencyRound(pool.currentBalance, pool.currency);
      const reservedBalance = currencyRound(pool.reservedBalance, pool.currency);
      const minimumThreshold = currencyRound(pool.minimumThreshold, pool.currency);
      const maximumThreshold = currencyRound(pool.maximumThreshold, pool.currency);
      const targetBalance = currencyRound(pool.targetBalance, pool.currency);
      if ([currentBalance, reservedBalance, minimumThreshold, maximumThreshold, targetBalance]
        .some(value => value.isNegative())) {
        throw new Error(`Liquidity pool ${pool.bankCode}/${pool.currency} cannot contain negative balances or thresholds`);
      }
      if (reservedBalance.greaterThan(currentBalance)) {
        throw new Error(`Liquidity pool ${pool.bankCode}/${pool.currency} has reserved funds above its current balance`);
      }
      if (!maximumThreshold.greaterThan(minimumThreshold)
        || targetBalance.lessThan(minimumThreshold)
        || targetBalance.greaterThan(maximumThreshold)) {
        throw new Error(`Liquidity pool ${pool.bankCode}/${pool.currency} has invalid thresholds or target balance`);
      }

      const available = currentBalance.minus(reservedBalance);
      const precision = currencyPrecision[pool.currency];
      const amountText = amount => amount.toFixed(precision);
      const counterparties = {
        PKR: [
          { bankCode: 'FABAEADU', bankName: 'First Abu Dhabi Bank (UAE Hub)' },
          { bankCode: 'MEZNBPKK', bankName: 'Meezan Bank (Karachi Hub)' },
        ],
        AED: [
          { bankCode: 'MEZNBPKK', bankName: 'Meezan Bank (Karachi Hub)' },
          { bankCode: 'FABAEADU', bankName: 'First Abu Dhabi Bank (UAE Hub)' },
        ],
        SAR: [
          { bankCode: 'MEZNBPKK', bankName: 'Meezan Bank (Karachi Hub)' },
          { bankCode: 'FABAEADU', bankName: 'First Abu Dhabi Bank (UAE Hub)' },
        ],
      };

      if (available.lessThan(minimumThreshold)) {
        const isCritical = available.lessThan(minimumThreshold.mul('0.4'));
        const deficit = targetBalance.minus(available);
        const currencyCounterparties = counterparties[pool.currency] || [];
        if (!currencyCounterparties.some(item => item.bankCode === pool.bankCode)) {
          throw new Error(`No configured counterparty is available for ${pool.bankCode}/${pool.currency}`);
        }
        const counterparty = currencyCounterparties.find(item => item.bankCode !== pool.bankCode);
        if (!counterparty) {
          throw new Error(`No configured counterparty is available for ${pool.bankCode}/${pool.currency}`);
        }

        alerts.push({
          alertId: randomUUID(),
          bankCode: pool.bankCode,
          bankName: pool.bankName,
          currency: pool.currency,
          currentBalance: amountText(currentBalance),
          availableBalance: amountText(available),
          thresholdType: isCritical ? 'CRITICAL_DEPLETION' : 'BELOW_MINIMUM',
          recommendedAction: `Recommendation only; no funds moved: inject ${amountText(deficit)} ${pool.currency} via ${counterparty.bankName} to reach target balance`,
          rebalanceAmountRequired: amountText(deficit),
          suggestedCounterpartyBank: `${counterparty.bankCode} (${counterparty.bankName})`,
          timestamp: new Date().toISOString(),
        });
      } else if (available.greaterThan(maximumThreshold)) {
        const surplus = available.minus(targetBalance);
        alerts.push({
          alertId: randomUUID(),
          bankCode: pool.bankCode,
          bankName: pool.bankName,
          currency: pool.currency,
          currentBalance: amountText(currentBalance),
          availableBalance: amountText(available),
          thresholdType: 'ABOVE_MAXIMUM',
          recommendedAction: `Recommendation only; no funds moved: sweep ${amountText(surplus)} ${pool.currency} to primary treasury vault`,
          rebalanceAmountRequired: amountText(surplus),
          suggestedCounterpartyBank: 'TREASURY_CENTRAL_VAULT',
          timestamp: new Date().toISOString(),
        });
      }
    }

    return alerts;
  }
}
