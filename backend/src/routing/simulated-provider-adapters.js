import { CORRIDOR_CONFIGURATIONS } from '../treasury/corridor-rates.js';

const sourceCurrencies = ['PKR', 'AED', 'SAR'];
const sourceCurrencyLiquidity = {
  PKR: '50000000.00',
  AED: '500000.00',
  SAR: '500000.00',
};

function makeAdapter({ id, label, estimatedMinutes, riskScore, flatFee, feeBps, availability }) {
  return Object.freeze({
    id,
    label,
    mode: 'SIMULATED',
    corridors: Object.freeze(Object.keys(CORRIDOR_CONFIGURATIONS)),
    supportedCurrencies: Object.freeze(sourceCurrencies),
    estimatedMinutes,
    riskScore,
    availability,
    feeModel: Object.freeze({
      flatFeeByCurrency: Object.freeze({ ...flatFee }),
      basisPoints: feeBps,
    }),
    simulatedLiquidityByCurrency: Object.freeze({ ...sourceCurrencyLiquidity }),
  });
}

export const SIMULATED_PROVIDER_ADAPTERS = Object.freeze([
  makeAdapter({
    id: 'SIM_FAST',
    label: 'Simulated Fast Rail',
    estimatedMinutes: 45,
    riskScore: 35,
    flatFee: { PKR: '350.00', AED: '1.50', SAR: '1.50' },
    feeBps: 35,
    availability: 'AVAILABLE',
  }),
  makeAdapter({
    id: 'SIM_ECONOMY',
    label: 'Simulated Economy Rail',
    estimatedMinutes: 240,
    riskScore: 20,
    flatFee: { PKR: '100.00', AED: '0.50', SAR: '0.50' },
    feeBps: 15,
    availability: 'AVAILABLE',
  }),
  makeAdapter({
    id: 'SIM_STANDARD',
    label: 'Simulated Standard Rail',
    estimatedMinutes: 120,
    riskScore: 15,
    flatFee: { PKR: '200.00', AED: '1.00', SAR: '1.00' },
    feeBps: 25,
    availability: 'AVAILABLE',
  }),
]);

export function getSimulatedProviderAdapterSummaries() {
  return SIMULATED_PROVIDER_ADAPTERS.map(adapter => ({
    id: adapter.id,
    label: adapter.label,
    mode: adapter.mode,
    corridors: [...adapter.corridors],
    supportedCurrencies: [...adapter.supportedCurrencies],
    estimatedMinutes: adapter.estimatedMinutes,
    feeBasisPoints: adapter.feeModel.basisPoints,
    availability: adapter.availability,
    riskScore: adapter.riskScore,
    liquidityLabel: 'SIMULATED_TEST_CAPACITY',
  }));
}
