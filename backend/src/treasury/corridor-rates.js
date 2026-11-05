// ============================================================================
// Corridor Configurations & Interbank Market Feeds (JavaScript ES Modules)
// Corridors: PK_AE, AE_PK, PK_SA, SA_PK
// ============================================================================

export const CORRIDOR_CONFIGURATIONS = {
  AE_PK: {
    code: 'AE_PK',
    sourceCurrency: 'AED',
    targetCurrency: 'PKR',
    baseSpreadBps: 30, // 0.30%
    volatilityBufferBps: 8,
    quoteTtlSeconds: 60,
    minTransferAmount: 10,
    maxTransferAmount: 100000,
  },
  PK_AE: {
    code: 'PK_AE',
    sourceCurrency: 'PKR',
    targetCurrency: 'AED',
    baseSpreadBps: 45, // 0.45%
    volatilityBufferBps: 12,
    quoteTtlSeconds: 45,
    minTransferAmount: 1000,
    maxTransferAmount: 10000000,
  },
  SA_PK: {
    code: 'SA_PK',
    sourceCurrency: 'SAR',
    targetCurrency: 'PKR',
    baseSpreadBps: 35,
    volatilityBufferBps: 8,
    quoteTtlSeconds: 60,
    minTransferAmount: 10,
    maxTransferAmount: 100000,
  },
  PK_SA: {
    code: 'PK_SA',
    sourceCurrency: 'PKR',
    targetCurrency: 'SAR',
    baseSpreadBps: 45,
    volatilityBufferBps: 12,
    quoteTtlSeconds: 45,
    minTransferAmount: 1000,
    maxTransferAmount: 10000000,
  },
};

export const MOCK_INTERBANK_RATES = {
  'AED/PKR': {
    pair: 'AED/PKR',
    baseCurrency: 'AED',
    quoteCurrency: 'PKR',
    midMarketRate: 76.25,
    referenceMidMarketRate: 76.25,
    bidRate: 76.15,
    askRate: 76.35,
    timestamp: new Date().toISOString(),
  },
  'PKR/AED': {
    pair: 'PKR/AED',
    baseCurrency: 'PKR',
    quoteCurrency: 'AED',
    midMarketRate: 0.013114,
    referenceMidMarketRate: 0.013114,
    bidRate: 0.013095,
    askRate: 0.013130,
    timestamp: new Date().toISOString(),
  },
  'SAR/PKR': {
    pair: 'SAR/PKR',
    baseCurrency: 'SAR',
    quoteCurrency: 'PKR',
    midMarketRate: 74.65,
    referenceMidMarketRate: 74.65,
    bidRate: 74.55,
    askRate: 74.75,
    timestamp: new Date().toISOString(),
  },
  'PKR/SAR': {
    pair: 'PKR/SAR',
    baseCurrency: 'PKR',
    quoteCurrency: 'SAR',
    midMarketRate: 0.013395,
    referenceMidMarketRate: 0.013395,
    bidRate: 0.013375,
    askRate: 0.013415,
    timestamp: new Date().toISOString(),
  },
  'USD/PKR': {
    pair: 'USD/PKR',
    baseCurrency: 'USD',
    quoteCurrency: 'PKR',
    midMarketRate: 279.50,
    referenceMidMarketRate: 279.50,
    bidRate: 279.30,
    askRate: 279.70,
    timestamp: new Date().toISOString(),
  },
};
