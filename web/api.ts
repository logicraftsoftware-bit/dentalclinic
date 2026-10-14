const pending = new Map<string, string>();
export async function api<T = any>(url: string, method = 'GET', body?: unknown): Promise<T> {
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
  const data = await response.json();
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
