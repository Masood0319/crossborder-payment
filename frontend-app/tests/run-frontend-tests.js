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
  'src/components/PublicSite.jsx',
  'src/pages/kyc.jsx',
  'src/pages/dashboard.jsx',
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
assert.ok(api.includes('/api/treasury/liquidity/alerts'), 'API client loads treasury liquidity alerts');
assert.ok(api.includes('/acknowledge'), 'API client can acknowledge a treasury alert');

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

console.log(`Frontend smoke checks passed (${requiredFiles.length} files, landing page, treasury API and consumer flows).`);
