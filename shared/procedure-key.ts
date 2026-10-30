// A procedure and its lab charge form one cancellable billing unit.
export function procedureKey(invoice: any): string {
  if (invoice.sourceKey?.match(/^[a-f0-9-]{36}:\d+:(PROCEDURE|LAB)$/i)) return invoice.sourceKey.replace(/:(PROCEDURE|LAB)$/i, '');
  return invoice.sourceKey?.startsWith('reception:') ? invoice.sourceKey.replace(/:(procedure|lab)$/, '')
    : invoice.sourceKey?.match(/:(procedure|lab):\d+$/) ? invoice.sourceKey.replace(/:(procedure|lab):(\d+)$/, ':line:$2') : invoice.id;
}
