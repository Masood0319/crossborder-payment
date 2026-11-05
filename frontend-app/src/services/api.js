export const API_BASE_URL = (
  process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:5000'
).replace(/\/+$/, '');

const TOKEN_KEY = 'crossborder.consumer.access-token';
const USER_KEY = 'crossborder.consumer.user';
const STAFF_TOKEN_KEY = 'crossborder.staff.access-token';
const STAFF_USER_KEY = 'crossborder.staff.user';

export function saveSession(session) {
  localStorage.setItem(TOKEN_KEY, session.token);
  localStorage.setItem(USER_KEY, JSON.stringify(session.user));
}

export function getSession() {
  if (typeof window === 'undefined') return null;
  const token = localStorage.getItem(TOKEN_KEY);
  const rawUser = localStorage.getItem(USER_KEY);
  if (!token || !rawUser) return null;
  try {
    return { token, user: JSON.parse(rawUser) };
  } catch {
    clearSession();
    return null;
  }
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function saveStaffSession(session) {
  localStorage.setItem(STAFF_TOKEN_KEY, session.token);
  localStorage.setItem(STAFF_USER_KEY, JSON.stringify(session.user));
}

export function getStaffSession() {
  if (typeof window === 'undefined') return null;
  const token = localStorage.getItem(STAFF_TOKEN_KEY);
  const rawUser = localStorage.getItem(STAFF_USER_KEY);
  if (!token || !rawUser) return null;
  try {
    return { token, user: JSON.parse(rawUser) };
  } catch {
    clearStaffSession();
    return null;
  }
}

export function clearStaffSession() {
  localStorage.removeItem(STAFF_TOKEN_KEY);
  localStorage.removeItem(STAFF_USER_KEY);
}

async function request(path, options = {}) {
  const isTreasuryRequest = path.startsWith('/api/treasury/');
  const session = isTreasuryRequest ? null : getSession();
  const staffSession = getStaffSession();
  const headers = new Headers(options.headers || {});

  if (options.body && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  if (session?.token) {
    headers.set('Authorization', `Bearer ${session.token}`);
  } else if (staffSession?.token) {
    headers.set('Authorization', `Bearer ${staffSession.token}`);
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
  });

  const type = response.headers.get('content-type') || '';
  const result = type.includes('application/json') ? await response.json() : await response.text();

  if (!response.ok) {
    if (response.status === 401) {
      if (session?.token) clearSession();
      if (staffSession?.token) clearStaffSession();
    }
    const message = result && typeof result === 'object' && result.error
      ? result.error
      : `Request failed (${response.status})`;
    throw new Error(message);
  }

  return result;
}

export function register(payload) {
  return request('/api/v1/auth/register', { method: 'POST', body: JSON.stringify(payload) });
}

export function login(payload) {
  return request('/api/v1/auth/login', { method: 'POST', body: JSON.stringify(payload) });
}

export function getWallet() {
  return request('/api/v1/wallet/balance');
}

export function topUpWallet(amount, currency, idempotencyKey) {
  return request('/api/v1/wallet/topup', {
    method: 'POST',
    headers: { 'X-Idempotency-Key': idempotencyKey },
    body: JSON.stringify({ amount, currency }),
  });
}

export function getBeneficiaries() {
  return request('/api/v1/beneficiaries');
}

export function addBeneficiary(payload) {
  return request('/api/v1/beneficiaries', { method: 'POST', body: JSON.stringify(payload) });
}

export function createFxQuote(payload) {
  return request('/api/v1/fx/quote', { method: 'POST', body: JSON.stringify(payload) });
}

export function sendTransfer(payload, idempotencyKey) {
  return request('/api/v1/transfers/send', {
    method: 'POST',
    headers: { 'X-Idempotency-Key': idempotencyKey },
    body: JSON.stringify(payload),
  });
}

export function submitKycDocument(documentType, file) {
  const form = new FormData();
  form.set('documentType', documentType);
  form.set('document', file);
  return request('/api/v1/auth/kyc', { method: 'POST', body: form });
}

export function getTransfer(id) {
  return request(`/api/v1/transfers/${encodeURIComponent(id)}`);
}

export function getTreasuryLiquidityAlerts() {
  return request('/api/treasury/liquidity/alerts');
}

export function acknowledgeTreasuryAlert(alertId) {
  return request(`/api/treasury/liquidity/alerts/${encodeURIComponent(alertId)}/acknowledge`, {
    method: 'POST',
  });
}
