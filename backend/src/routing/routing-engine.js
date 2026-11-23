import { Prisma } from '@prisma/client';
import { CORRIDOR_CONFIGURATIONS } from '../treasury/corridor-rates.js';
import { SIMULATED_PROVIDER_ADAPTERS } from './simulated-provider-adapters.js';

const Decimal = Prisma.Decimal;
const currencyPrecision = { PKR: 2, AED: 2, SAR: 2 };
const countryCurrency = { PK: 'PKR', AE: 'AED', SA: 'SAR' };
const pairCorridor = {
  'PK:AE': 'PK_AE',
  'AE:PK': 'AE_PK',
  'PK:SA': 'PK_SA',
  'SA:PK': 'SA_PK',
};

function strategyWeights(prefix, defaults, environment = process.env) {
  const weights = Object.fromEntries(Object.entries(defaults).map(([dimension, fallback]) => {
    const key = `ROUTING_${prefix}_${dimension.toUpperCase()}_WEIGHT`;
    const configured = environment[key] ?? fallback;
    const value = decimal(configured, key);
    if (value.isNegative()) throw new Error(`${key} must be a nonnegative decimal`);
    return [dimension, value.toString()];
  }));
  const total = Object.values(weights).reduce((sum, weight) => sum.plus(weight), new Decimal(0));
  if (!total.equals(1)) throw new Error(`ROUTING_${prefix}_*_WEIGHT values must sum to 1`);
  return Object.freeze(weights);
}

export function getRoutingStrategies(environment = process.env) {
  return [
    ['LOWEST_COST', 'Lowest cost', { cost: '0.70', speed: '0.10', risk: '0.20' }],
    ['FASTEST', 'Fastest estimated processing', { cost: '0.15', speed: '0.70', risk: '0.15' }],
    ['BALANCED', 'Balanced optimization', { cost: '0.40', speed: '0.35', risk: '0.25' }],
  ].reduce((strategies, [id, label, defaults]) => {
    strategies[id] = Object.freeze({ label, weights: strategyWeights(id, defaults, environment) });
    return strategies;
  }, {});
}

export const ROUTING_STRATEGIES = Object.freeze(getRoutingStrategies());

function decimal(value, description) {
  let result;
  try {
    result = new Decimal(value);
  } catch {
    throw new Error(`${description} must be a valid decimal amount`);
  }
  if (!result.isFinite()) throw new Error(`${description} must be a valid decimal amount`);
  return result;
}

function roundCurrency(value, currency) {
  const precision = currencyPrecision[currency];
  if (precision === undefined) throw new Error(`Unsupported routing currency ${currency}`);
  return value.toDecimalPlaces(precision, Decimal.ROUND_HALF_UP);
}

function normalizeInput(input) {
  if (!input || typeof input !== 'object') throw new Error('Routing input is required');
  const sourceCountry = input.sourceCountry;
  const destinationCountry = input.destinationCountry;
  const sourceCurrency = input.sourceCurrency;
  const destinationCurrency = input.destinationCurrency;
  if (!Object.hasOwn(countryCurrency, sourceCountry) || !Object.hasOwn(countryCurrency, destinationCountry)) {
    throw new Error('Source and destination countries must be PK, AE, or SA');
  }
  if (sourceCountry === destinationCountry) throw new Error('Same-country routing is not supported');
  if (countryCurrency[sourceCountry] !== sourceCurrency || countryCurrency[destinationCountry] !== destinationCurrency) {
    throw new Error('Currency does not match the selected source or destination country');
  }
  const corridorCode = pairCorridor[`${sourceCountry}:${destinationCountry}`];
  const corridor = CORRIDOR_CONFIGURATIONS[corridorCode];
  if (!corridor || corridor.sourceCurrency !== sourceCurrency || corridor.targetCurrency !== destinationCurrency) {
    throw new Error('Currency pair is not supported for the selected corridor');
  }

  const amount = decimal(input.amount, 'Transfer amount');
  if (!amount.greaterThan(0)) throw new Error('Transfer amount must be positive');
  const roundedAmount = roundCurrency(amount, sourceCurrency);
  if (!roundedAmount.equals(amount)) {
    throw new Error(`Transfer amount must have no more than ${currencyPrecision[sourceCurrency]} decimal places`);
  }
  if (amount.lessThan(corridor.minTransferAmount) || amount.greaterThan(corridor.maxTransferAmount)) {
    throw new Error(`Transfer amount is outside the configured ${corridorCode} range`);
  }

  const preferredSpeed = input.preferredSpeed || 'STANDARD';
  if (!['FLEXIBLE', 'STANDARD', 'URGENT'].includes(preferredSpeed)) {
    throw new Error('Preferred speed must be FLEXIBLE, STANDARD, or URGENT');
  }
  const strategy = input.strategy || 'BALANCED';
  if (!Object.hasOwn(ROUTING_STRATEGIES, strategy)) {
    throw new Error('Routing strategy must be LOWEST_COST, FASTEST, or BALANCED');
  }
  if (input.exchangeRate !== undefined && input.exchangeRate !== null) {
    const exchangeRate = decimal(input.exchangeRate, 'Exchange rate');
    if (!exchangeRate.isPositive()) throw new Error('Exchange rate must be positive');
  }

  return { ...input, sourceCountry, destinationCountry, sourceCurrency, destinationCurrency, corridorCode, amount, preferredSpeed, strategy };
}

function routeFee(adapter, amount, currency) {
  const flat = decimal(adapter.feeModel.flatFeeByCurrency[currency], 'Provider flat fee');
  const variable = amount.mul(adapter.feeModel.basisPoints).div(10000);
  return roundCurrency(flat.plus(variable), currency);
}

function evaluateAdapter(adapter, input) {
  const rejectionReasons = [];
  const corridor = CORRIDOR_CONFIGURATIONS[input.corridorCode];
  if (!adapter.corridors.includes(input.corridorCode)) rejectionReasons.push('Provider does not support this corridor');
  if (!adapter.supportedCurrencies.includes(input.sourceCurrency)
    || !adapter.supportedCurrencies.includes(input.destinationCurrency)) {
    rejectionReasons.push('Provider does not support this currency pair');
  }
  if (!corridor) rejectionReasons.push('Corridor is not configured');
  if (adapter.availability !== 'AVAILABLE') rejectionReasons.push('Provider is simulated as unavailable');

  const liquidity = adapter.simulatedLiquidityByCurrency[input.sourceCurrency];
  const availableLiquidity = liquidity === undefined ? null : decimal(liquidity, 'Simulated liquidity');
  const estimatedFee = routeFee(adapter, input.amount, input.sourceCurrency);
  const requiredAmount = input.amount.plus(estimatedFee);
  if (!availableLiquidity || availableLiquidity.lessThan(requiredAmount)) {
    rejectionReasons.push('Insufficient simulated liquidity for amount plus estimated provider fee');
  }

  if (input.preferredSpeed === 'URGENT' && adapter.estimatedMinutes > 60) {
    rejectionReasons.push('Estimated processing time exceeds the urgent preference');
  }

  const exchangeRate = input.exchangeRate == null ? null : decimal(input.exchangeRate, 'Exchange rate');
  const estimatedReceivingAmount = exchangeRate
    ? roundCurrency(input.amount.minus(estimatedFee).mul(exchangeRate), input.destinationCurrency)
    : null;
  if (estimatedReceivingAmount && estimatedReceivingAmount.isNegative()) {
    rejectionReasons.push('Estimated provider fee exceeds transfer amount');
  }

  return {
    routeId: `${input.corridorCode}:${adapter.id}`,
    corridorCode: input.corridorCode,
    providerAdapter: { id: adapter.id, label: adapter.label, mode: adapter.mode },
    estimatedFee: estimatedFee.toFixed(currencyPrecision[input.sourceCurrency]),
    feeCurrency: input.sourceCurrency,
    estimatedFxRate: exchangeRate?.toFixed(6) ?? null,
    estimatedReceivingAmount: estimatedReceivingAmount?.toFixed(currencyPrecision[input.destinationCurrency]) ?? null,
    receivingCurrency: input.destinationCurrency,
    estimatedProcessingMinutes: adapter.estimatedMinutes,
    availability: adapter.availability,
    liquidityEligible: Boolean(availableLiquidity?.greaterThanOrEqualTo(requiredAmount)),
    simulatedLiquidityStatus: availableLiquidity?.greaterThanOrEqualTo(requiredAmount) ? 'SUFFICIENT_SIMULATED_CAPACITY' : 'INSUFFICIENT_SIMULATED_CAPACITY',
    riskScore: adapter.riskScore,
    score: null,
    eligible: rejectionReasons.length === 0,
    rejectionReasons,
    selectionExplanation: null,
    _fee: estimatedFee,
  };
}

function rangeScore(value, minimum, maximum, inverse) {
  if (maximum.equals(minimum)) return new Decimal(100);
  const relative = inverse
    ? maximum.minus(value).div(maximum.minus(minimum))
    : value.minus(minimum).div(maximum.minus(minimum));
  return relative.mul(100);
}

function scoreCandidates(candidates, strategy) {
  if (candidates.length === 0) return [];
  const policy = ROUTING_STRATEGIES[strategy];
  const fees = candidates.map(candidate => candidate._fee);
  const times = candidates.map(candidate => new Decimal(candidate.estimatedProcessingMinutes));
  const risks = candidates.map(candidate => new Decimal(candidate.riskScore));
  const minFee = Decimal.min(...fees);
  const maxFee = Decimal.max(...fees);
  const minTime = Decimal.min(...times);
  const maxTime = Decimal.max(...times);
  const minRisk = Decimal.min(...risks);
  const maxRisk = Decimal.max(...risks);

  return candidates.map(candidate => {
    const fee = candidate._fee;
    const time = new Decimal(candidate.estimatedProcessingMinutes);
    const risk = new Decimal(candidate.riskScore);
    const costScore = rangeScore(fee, minFee, maxFee, true);
    const speedScore = rangeScore(time, minTime, maxTime, true);
    const riskScore = rangeScore(risk, minRisk, maxRisk, true);
    const weighted = costScore.mul(policy.weights.cost)
      .plus(speedScore.mul(policy.weights.speed))
      .plus(riskScore.mul(policy.weights.risk))
      .toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
    const components = [
      { label: 'cost', score: costScore },
      { label: 'speed', score: speedScore },
      { label: 'operational risk', score: riskScore },
    ].sort((a, b) => b.score.comparedTo(a.score));
    const preferenceNote = candidate.estimatedProcessingMinutes > 60 && strategy === 'FASTEST'
      ? 'This route is slower than the fastest eligible option.'
      : `${policy.label} weights cost, estimated processing time, and configured operational risk.`;
    return {
      ...candidate,
      score: weighted.toFixed(4),
      selectionExplanation: `Weighted score ${weighted.toFixed(4)}; strongest component is ${components[0].label}. ${preferenceNote}`,
      _score: weighted,
    };
  }).sort((a, b) => {
    const scoreOrder = b._score.comparedTo(a._score);
    return scoreOrder || a.routeId.localeCompare(b.routeId);
  }).map(({ _fee, _score, ...candidate }, index) => ({
    ...candidate,
    rank: index + 1,
  }));
}

export class PaymentRoutingEngine {
  constructor({ adapters = SIMULATED_PROVIDER_ADAPTERS } = {}) {
    if (!Array.isArray(adapters)) throw new Error('Provider adapters must be an array');
    this.adapters = adapters;
  }

  compare(input) {
    const normalized = normalizeInput(input);
    const allRoutes = this.adapters.map(adapter => evaluateAdapter(adapter, normalized));
    const eligible = allRoutes.filter(route => route.eligible);
    const ranked = scoreCandidates(eligible, normalized.strategy);
    const selected = ranked[0] || null;
    const alternatives = ranked.slice(1).map(route => ({
      ...route,
      selectionExplanation: `${route.selectionExplanation} Ranked below ${selected.routeId} under ${ROUTING_STRATEGIES[normalized.strategy].label.toLowerCase()}.`,
    }));
    const rejectedRoutes = allRoutes
      .filter(route => !route.eligible)
      .map(({ _fee, ...route }) => route);
    return {
      strategy: normalized.strategy,
      strategyLabel: ROUTING_STRATEGIES[normalized.strategy].label,
      preferredSpeed: normalized.preferredSpeed,
      corridorCode: normalized.corridorCode,
      sourceCurrency: normalized.sourceCurrency,
      destinationCurrency: normalized.destinationCurrency,
      amount: normalized.amount.toFixed(currencyPrecision[normalized.sourceCurrency]),
      executionMode: 'SIMULATED',
      selectedRoute: selected,
      alternatives,
      rejectedRoutes,
      decisionReason: selected
        ? `${selected.providerAdapter.label} selected as rank 1 by the ${ROUTING_STRATEGIES[normalized.strategy].label.toLowerCase()} strategy. All provider rates, availability, fees, liquidity and processing estimates are simulated.`
        : 'No eligible simulated provider route met corridor, availability, speed, and liquidity checks.',
    };
  }

  route(input) {
    const comparison = this.compare(input);
    if (!comparison.selectedRoute) {
      const error = new Error(comparison.decisionReason);
      error.code = 'NO_ELIGIBLE_ROUTES';
      error.comparison = comparison;
      throw error;
    }
    return comparison;
  }
}

export function routingInputFromCorridor(corridorCode, amount, strategy = 'BALANCED', preferredSpeed = 'STANDARD', exchangeRate = null) {
  const [sourceCountry, destinationCountry] = corridorCode.split('_');
  return {
    sourceCountry,
    destinationCountry,
    sourceCurrency: countryCurrency[sourceCountry],
    destinationCurrency: countryCurrency[destinationCountry],
    amount,
    strategy,
    preferredSpeed,
    exchangeRate,
  };
}

export function listRoutingStrategies() {
  return Object.entries(ROUTING_STRATEGIES).map(([id, policy]) => ({
    id,
    label: policy.label,
    weights: policy.weights,
  }));
}
