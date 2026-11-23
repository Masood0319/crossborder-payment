import assert from 'node:assert/strict';
import test from 'node:test';
import { getRoutingStrategies, PaymentRoutingEngine } from '../src/routing/routing-engine.js';
import { SIMULATED_PROVIDER_ADAPTERS } from '../src/routing/simulated-provider-adapters.js';

const engine = new PaymentRoutingEngine();
const validInput = {
  sourceCountry: 'PK',
  destinationCountry: 'AE',
  sourceCurrency: 'PKR',
  destinationCurrency: 'AED',
  amount: '10000.00',
  preferredSpeed: 'STANDARD',
  exchangeRate: '0.012340',
};

test('lowest-cost strategy selects the lowest estimated fee route', () => {
  const result = engine.route({ ...validInput, strategy: 'LOWEST_COST' });
  assert.equal(result.selectedRoute.providerAdapter.id, 'SIM_ECONOMY');
  assert.equal(result.selectedRoute.estimatedFee, '115.00');
  assert.match(result.decisionReason, /simulated/i);
  assert.equal(result.alternatives.length, 2);
  assert.ok(result.alternatives[0].score >= result.alternatives[1].score);
});

test('fastest strategy selects the shortest estimated processing route', () => {
  const result = engine.route({ ...validInput, strategy: 'FASTEST' });
  assert.equal(result.selectedRoute.providerAdapter.id, 'SIM_FAST');
  assert.equal(result.selectedRoute.estimatedProcessingMinutes, 45);
});

test('balanced strategy weighs cost, time, and operational risk', () => {
  const result = engine.route({ ...validInput, strategy: 'BALANCED' });
  assert.equal(result.selectedRoute.providerAdapter.id, 'SIM_STANDARD');
  assert.match(result.selectedRoute.selectionExplanation, /cost|speed|risk/i);
});

test('unsupported corridor, invalid currency, invalid amount and excessive precision are rejected', () => {
  assert.throws(() => engine.compare({ ...validInput, sourceCountry: 'PK', destinationCountry: 'PK' }), /Same-country routing/);
  assert.throws(() => engine.compare({ ...validInput, destinationCurrency: 'SAR' }), /Currency does not match/);
  assert.throws(() => engine.compare({ ...validInput, sourceCurrency: 'USD' }), /Currency does not match/);
  assert.throws(() => engine.compare({ ...validInput, amount: 'not-money' }), /valid decimal amount/);
  assert.throws(() => engine.compare({ ...validInput, amount: '0' }), /must be positive/);
  assert.throws(() => engine.compare({ ...validInput, amount: '10000.001' }), /no more than 2 decimal places/);
});

test('urgent preference excludes routes slower than one hour', () => {
  const result = engine.route({ ...validInput, strategy: 'BALANCED', preferredSpeed: 'URGENT' });
  assert.equal(result.selectedRoute.providerAdapter.id, 'SIM_FAST');
  assert.ok(result.rejectedRoutes.every(route => route.rejectionReasons.some(reason => /urgent preference/.test(reason))));
});

test('insufficient simulated liquidity is reported as an ineligible route', () => {
  const adapters = SIMULATED_PROVIDER_ADAPTERS.map(adapter => ({
    ...adapter,
    simulatedLiquidityByCurrency: { ...adapter.simulatedLiquidityByCurrency, PKR: '500.00' },
  }));
  const result = new PaymentRoutingEngine({ adapters }).compare(validInput);
  assert.equal(result.selectedRoute, null);
  assert.ok(result.rejectedRoutes.every(route => route.liquidityEligible === false));
  assert.ok(result.rejectedRoutes.every(route => route.rejectionReasons.some(reason => /simulated liquidity/.test(reason))));
});

test('unavailable providers are excluded and a fully unavailable set has no eligible route', () => {
  const adapters = SIMULATED_PROVIDER_ADAPTERS.map(adapter => ({ ...adapter, availability: 'UNAVAILABLE' }));
  const routing = new PaymentRoutingEngine({ adapters });
  const comparison = routing.compare(validInput);
  assert.equal(comparison.selectedRoute, null);
  assert.ok(comparison.rejectedRoutes.every(route => route.rejectionReasons.includes('Provider is simulated as unavailable')));
  assert.throws(() => routing.route(validInput), error => error.code === 'NO_ELIGIBLE_ROUTES');
});

test('currency fee and receiving estimates use decimal arithmetic and stable scales', () => {
  const result = engine.route({ ...validInput, amount: '10000.31', strategy: 'BALANCED' });
  assert.equal(result.selectedRoute.estimatedFee, '225.00');
  assert.equal(result.selectedRoute.estimatedReceivingAmount, '120.63');
  assert.equal(result.selectedRoute.estimatedFxRate, '0.012340');
  assert.equal(result.selectedRoute.feeCurrency, 'PKR');
  assert.equal(result.selectedRoute.receivingCurrency, 'AED');
});

test('route ranking is deterministic for equal input and stable tie-breaks', () => {
  const adapters = SIMULATED_PROVIDER_ADAPTERS.map(adapter => ({
    ...adapter,
    estimatedMinutes: 100,
    riskScore: 20,
    feeModel: { flatFeeByCurrency: { PKR: '100.00', AED: '1.00', SAR: '1.00' }, basisPoints: 10 },
  }));
  const routing = new PaymentRoutingEngine({ adapters });
  const first = routing.route(validInput);
  const second = routing.route(validInput);
  assert.equal(first.selectedRoute.routeId, second.selectedRoute.routeId);
  assert.deepEqual(
    [first.selectedRoute, ...first.alternatives].map(route => route.routeId),
    [second.selectedRoute, ...second.alternatives].map(route => route.routeId)
  );
  assert.equal(first.selectedRoute.routeId, 'PK_AE:SIM_ECONOMY');
});

test('all configured initial corridors use their configured country and currency direction', () => {
  const corridors = [
    { sourceCountry: 'PK', destinationCountry: 'AE', sourceCurrency: 'PKR', destinationCurrency: 'AED', amount: '1000.00' },
    { sourceCountry: 'AE', destinationCountry: 'PK', sourceCurrency: 'AED', destinationCurrency: 'PKR', amount: '10.00' },
    { sourceCountry: 'PK', destinationCountry: 'SA', sourceCurrency: 'PKR', destinationCurrency: 'SAR', amount: '1000.00' },
    { sourceCountry: 'SA', destinationCountry: 'PK', sourceCurrency: 'SAR', destinationCurrency: 'PKR', amount: '10.00' },
  ];
  for (const corridor of corridors) {
    assert.ok(engine.route({ ...corridor, strategy: 'BALANCED' }).selectedRoute);
  }
});

test('strategy weights are configurable and must remain normalized', () => {
  const strategies = getRoutingStrategies({
    ROUTING_LOWEST_COST_COST_WEIGHT: '0.60',
    ROUTING_LOWEST_COST_SPEED_WEIGHT: '0.20',
    ROUTING_LOWEST_COST_RISK_WEIGHT: '0.20',
  });
  assert.deepEqual(strategies.LOWEST_COST.weights, { cost: '0.6', speed: '0.2', risk: '0.2' });
  assert.throws(() => getRoutingStrategies({
    ROUTING_BALANCED_COST_WEIGHT: '0.5',
    ROUTING_BALANCED_SPEED_WEIGHT: '0.5',
    ROUTING_BALANCED_RISK_WEIGHT: '0.5',
  }), /must sum to 1/);
});
