export const API_BASE_URL = (
  process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:5001'
).replace(/\/+$/, '');

const USER_KEY = 'crossborder.consumer.user';
const STAFF_TOKEN_KEY = 'crossborder.staff.access-token';
const STAFF_USER_KEY = 'crossborder.staff.user';

export function saveSession(session) {
  localStorage.setItem(USER_KEY, JSON.stringify(session.user));
}

export function getSession() {
  if (typeof window === 'undefined') return null;
  const rawUser = localStorage.getItem(USER_KEY);
  if (!rawUser) return null;
  try {
    return { user: JSON.parse(rawUser) };
  } catch {
    clearSession();
    return null;
  }
}

export function clearSession() {
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
  const isStaffRequest = path.startsWith('/api/treasury/') || path.startsWith('/api/v1/admin/');
  const session = isStaffRequest ? null : getSession();
  const staffSession = getStaffSession();
  const headers = new Headers(options.headers || {});

  if (options.body && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  if (staffSession?.token) {
    headers.set('Authorization', `Bearer ${staffSession.token}`);
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
    credentials: 'include',
  });

  const type = response.headers.get('content-type') || '';
  const result = type.includes('application/json') ? await response.json() : await response.text();

  if (!response.ok) {
    if (response.status === 401) {
      if (!isStaffRequest) clearSession();
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

export function getConsumerSession() {
  return request('/api/v1/auth/session');
}

export async function logout() {
  await request('/api/v1/auth/logout', { method: 'POST' });
  clearSession();
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

export function updateBeneficiary(id, payload) {
  return request(`/api/v1/beneficiaries/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export function deleteBeneficiary(id) {
  return request(`/api/v1/beneficiaries/${encodeURIComponent(id)}`, { method: 'DELETE' });
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

export function getRoutingStrategies() {
  return request('/api/v1/routing/strategies');
}

export function previewRoutes(payload) {
  return request('/api/v1/routing/preview', {
    method: 'POST',
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

export function getTransferRoutingDecision(id) {
  return request(`/api/v1/transfers/${encodeURIComponent(id)}/routing`);
}

export function getTransfers({ page = 1, pageSize = 10, status = '', query = '', from = '', to = '' } = {}) {
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (status) params.set('status', status);
  if (query.trim()) params.set('query', query.trim());
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  return request(`/api/v1/transfers?${params.toString()}`);
}

export function getTreasuryLiquidityAlerts() {
  return request('/api/treasury/liquidity/alerts');
}

export function acknowledgeTreasuryAlert(alertId) {
  return request(`/api/treasury/liquidity/alerts/${encodeURIComponent(alertId)}/acknowledge`, {
    method: 'POST',
  });
}

export function getOperationsSummary() {
  return request('/api/treasury/operations/summary');
}

export function getOperationsTransfers(filters = {}) {
  const params = new URLSearchParams({ page: String(filters.page || 1), pageSize: String(filters.pageSize || 20) });
  for (const key of ['query', 'status', 'currency', 'corridor']) {
    if (filters[key]?.trim?.()) params.set(key, filters[key].trim());
    else if (filters[key]) params.set(key, filters[key]);
  }
  return request(`/api/treasury/operations/transfers?${params.toString()}`);
}

export function getOperationsTransfer(id) {
  return request(`/api/treasury/operations/transfers/${encodeURIComponent(id)}`);
}

export function getActiveFxQuotes() {
  return request('/api/treasury/fx/quotes');
}

export function getRoutingAnalytics() {
  return request('/api/treasury/routing/analytics');
}

export function getKycApplicants() {
  return request('/api/v1/admin/kyc');
}

export function reviewKycApplicant(userId, status, reason) {
  return request(`/api/v1/admin/kyc/${encodeURIComponent(userId)}/review`, {
    method: 'POST',
    body: JSON.stringify({ status, reason }),
  });
}

export function getKycReviewHistory(userId) {
  return request(`/api/v1/admin/kyc/${encodeURIComponent(userId)}/reviews`);
}

export async function fetchKycDocument(userId, documentId) {
  const staffSession = getStaffSession();
  const response = await fetch(
    `${API_BASE_URL}/api/v1/admin/kyc/${encodeURIComponent(userId)}/documents/${encodeURIComponent(documentId)}`,
    { headers: staffSession?.token ? { Authorization: `Bearer ${staffSession.token}` } : {} }
  );
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    if ((response.headers.get('content-type') || '').includes('application/json')) {
      const body = await response.json();
      if (body?.error) message = body.error;
    }
    throw new Error(message);
  }
  return response.blob();
}
