// Expose categories, never connection strings or raw query values.
export function databaseDiagnostic(error: any) {
  const detail = String(error?.meta?.message || error?.message || '');
  let reason = 'DATABASE_COMMAND_FAILED';
  if (/authentication|bad auth|scram|credentials/i.test(detail)) reason = 'DATABASE_AUTH_FAILED';
  else if (/DNS|SRV|no record found|resolve.*host/i.test(detail)) reason = 'DATABASE_DNS_FAILED';
  else if (/server selection|timed out|connection refused|no available servers|network/i.test(detail)) reason = 'DATABASE_CONNECTION_FAILED';
  else if (/not authorized|unauthorized|permission/i.test(detail)) reason = 'DATABASE_PERMISSION_DENIED';
  else if (/query engine|engine.*not found|openssl/i.test(detail)) reason = 'DATABASE_ENGINE_UNAVAILABLE';
  return { reason, code: typeof error?.code === 'string' ? error.code : 'UNKNOWN', databaseCode: typeof error?.meta?.code === 'number' || typeof error?.meta?.code === 'string' ? String(error.meta.code) : undefined };
}
