// A procedure and its lab charge form one cancellable billing unit.
export function procedureKey(invoice: any): string {
  return invoice.sourceKey?.startsWith('reception:') ? invoice.sourceKey.replace(/:(procedure|lab)$/, '')
    : invoice.sourceKey?.match(/:(procedure|lab):\d+$/) ? invoice.sourceKey.replace(/:(procedure|lab):(\d+)$/, ':line:$2') : invoice.id;
}
