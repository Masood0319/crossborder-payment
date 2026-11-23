const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const requiredFiles = [
  'src/pages/login.jsx',
  'src/pages/register.jsx',
  'src/pages/index.jsx',
  'src/pages/privacy.jsx',
  'src/pages/terms.jsx',
  'src/pages/treasury.jsx',
  'src/pages/operations.jsx',
  'src/pages/compliance.jsx',
  'src/components/PublicSite.jsx',
  'src/pages/kyc.jsx',
  'src/pages/dashboard.jsx',
  'src/pages/transfers.jsx',
  'src/pages/beneficiaries.jsx',
  'src/pages/send.jsx',
  'src/pages/transfer/[id].jsx',
  'src/components/ConsumerLayout.jsx',
  'src/services/api.js',
];

for (const file of requiredFiles) {
  assert.ok(fs.existsSync(path.join(root, file)), `Consumer app file exists: ${file}`);
}

const api = fs.readFileSync(path.join(root, 'src/services/api.js'), 'utf8');
for (const route of ['/auth/register', '/auth/login', '/auth/kyc', '/wallet/balance', '/wallet/topup', '/fx/quote', '/transfers/send', '/transfers/', '/beneficiaries']) {
  assert.ok(api.includes(route), `API client is connected to ${route}`);
}
assert.match(api, /export function getTransfers/);
assert.match(api, /export function updateBeneficiary/);
assert.match(api, /export function deleteBeneficiary/);
assert.match(api, /\/transfers\?/);
assert.ok(api.includes('/api/treasury/liquidity/alerts'), 'API client loads treasury liquidity alerts');
assert.ok(api.includes('/acknowledge'), 'API client can acknowledge a treasury alert');
assert.match(api, /export function getOperationsSummary/);
assert.match(api, /export function getOperationsTransfers/);
assert.match(api, /export function getActiveFxQuotes/);
assert.match(api, /export function getRoutingStrategies/);
assert.match(api, /export function previewRoutes/);
assert.match(api, /export function getTransferRoutingDecision/);
assert.match(api, /export function getRoutingAnalytics/);
assert.match(api, /export function getConsumerSession/);
assert.match(api, /export async function logout/);
assert.match(api, /credentials: 'include'/);
assert.doesNotMatch(api, /localStorage\.setItem\(TOKEN_KEY|crossborder\.consumer\.access-token/);
assert.match(api, /export function getKycApplicants/);
assert.match(api, /export function reviewKycApplicant/);

const landingPage = fs.readFileSync(path.join(root, 'src/pages/index.jsx'), 'utf8');
for (const section of ['how-it-works', 'features', 'security', 'about']) {
  assert.ok(landingPage.includes(`id="${section}"`), `Landing page includes the ${section} section`);
}
assert.match(landingPage, /no real-money settlement occurs/i);
assert.match(landingPage, /static demo market-rate data/i);

const publicSite = fs.readFileSync(path.join(root, 'src/components/PublicSite.jsx'), 'utf8');
for (const href of ['/login', '/register', '/privacy', '/terms', '/#how-it-works', '/#features', '/#security', '/#about']) {
  assert.ok(publicSite.includes(href), `Public navigation points to ${href}`);
}

const sendPage = fs.readFileSync(path.join(root, 'src/pages/send.jsx'), 'utf8');
assert.match(sendPage, /Review before you send/);
assert.match(sendPage, /payment PIN/);

const transfersPage = fs.readFileSync(path.join(root, 'src/pages/transfers.jsx'), 'utf8');
assert.match(transfersPage, /Search reference or recipient/);
assert.match(transfersPage, /Previous/);
assert.match(transfersPage, /Demonstration records only/);
assert.match(transfersPage, /transfer-from/);
assert.match(transfersPage, /transfer-to/);
assert.match(transfersPage, /Retry/);

const beneficiariesPage = fs.readFileSync(path.join(root, 'src/pages/beneficiaries.jsx'), 'utf8');
assert.match(beneficiariesPage, /Bank account ownership is not verified/);
assert.match(beneficiariesPage, /updateBeneficiary/);
assert.match(beneficiariesPage, /deleteBeneficiary/);

const transferDetail = fs.readFileSync(path.join(root, 'src/pages/transfer/[id].jsx'), 'utf8');
assert.match(transferDetail, /Print \/ save receipt/);
assert.match(transferDetail, /••••/);
assert.match(transferDetail, /Complete lifecycle/);
assert.match(transferDetail, /lifecycle\?\.timeline/);

const operationsPage = fs.readFileSync(path.join(root, 'src/pages/operations.jsx'), 'utf8');
assert.match(operationsPage, /Transfer queue/);
assert.match(operationsPage, /Apply filters/);
assert.match(operationsPage, /Failure investigation reason/);
assert.match(operationsPage, /Simulation only/);
assert.match(operationsPage, /RoutingAnalyticsPanel/);
assert.match(operationsPage, /Recent route comparisons/);

const compliancePage = fs.readFileSync(path.join(root, 'src/pages/compliance.jsx'), 'utf8');
assert.match(compliancePage, /Identity review queue/);
assert.match(compliancePage, /Record decision/);
assert.match(compliancePage, /automated risk flags and authoritative sanctions screening are not available/i);

console.log(`Frontend smoke checks passed (${requiredFiles.length} files, customer workflows, staff operations, treasury and KYC review).`);
