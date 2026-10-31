// Legacy treatment invoices may have a session without an explicit charge kind.
export function commissionEligible(invoice: any) {
  if (invoice.chargeKind === 'LAB' || invoice.chargeKind === 'VISIT' || invoice.billCategory === 'CLINIC') return false;
  if (/^Lab\s*:/i.test(invoice.description || '') || /^(clinic fee|consultant fee|visiting consultant fee)$/i.test(invoice.description || '')) return false;
  return invoice.chargeKind === 'PROCEDURE' || !!invoice.sessionId;
}
