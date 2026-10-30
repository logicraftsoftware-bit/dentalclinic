// Private, tab-local cache only. Never persist clinic records to browser storage.
const reads = new Map<string, { promise: Promise<any>; expiresAt: number }>();
const READ_TTL_MS = 15_000;
export function clearApiReads() { reads.clear(); }
export function primeApiRead(url: string, value: any) {
  reads.set(url, { promise: Promise.resolve(value), expiresAt: Date.now() + READ_TTL_MS });
}
export function api<T = any>(url: string, method = 'GET', body?: unknown): Promise<T> {
  if (method !== 'GET') {
    clearApiReads();
    return request<T>(url, method, body).finally(clearApiReads);
  }
  // Audit-producing reads and authentication always reach the server.
  if (!url.startsWith('/clinic/') && !url.startsWith('/public/')) return request<T>(url, method, body);
  if (url.split('?')[0] === '/clinic/export' || url.split('?')[0].endsWith('/download')) return request<T>(url, method, body);
  const cached = reads.get(url);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;
  const entry = { promise: null as unknown as Promise<T>, expiresAt: Infinity };
  entry.promise = request<T>(url, method, body).then(value => {
    entry.expiresAt = Date.now() + READ_TTL_MS;
    return value;
  }, error => {
    if (reads.get(url) === entry) reads.delete(url);
    throw error;
  });
  reads.set(url, entry);
  // Bound memory when searching many different names or phone numbers.
  if (reads.size > 100) reads.delete(reads.keys().next().value!);
  return entry.promise;
}
const pending = new Map<string, string>();
async function request<T = any>(url: string, method = 'GET', body?: unknown): Promise<T> {
  const mutation = method !== 'GET';
  const fingerprint = JSON.stringify([
    url,
    method,
    body instanceof FormData
      ? [...body.entries()].map(([key, value]) => [
          key,
          value instanceof File ? `${value.name}:${value.size}:${value.lastModified}` : value,
        ])
      : body,
  ]);
  const key = pending.get(fingerprint) || crypto.randomUUID();
  if (mutation) pending.set(fingerprint, key);
  const response = await fetch(`/api${url}`, {
    method,
    credentials: 'same-origin',
    headers: {
      ...(body instanceof FormData ? {} : body ? { 'Content-Type': 'application/json' } : {}),
      ...(mutation ? { 'Idempotency-Key': key } : {}),
    },
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new Error(response.status >= 500
      ? 'The server is temporarily unavailable. Please try again shortly.'
      : 'The server returned an unexpected response. Please refresh and try again.');
  }
  let data: any;
  try { data = await response.json(); }
  catch { throw new Error('The server returned incomplete data. Please try again.'); }
  pending.delete(fingerprint);
  if (!response.ok) throw new Error(data.error || 'Request failed.');
  return data;
}
export const money = (paise: number = 0) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: paise % 100 ? 2 : 0,
  }).format(paise / 100);
export const day = (s: string) =>
  new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }).format(
    new Date(s),
  );
export const initials = (name: string = '') =>
  name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((x) => x[0])
    .join('')
    .toUpperCase();
