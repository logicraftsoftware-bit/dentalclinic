export function calendarDays(month: string) {
  const [year, number] = month.split('-').map(Number);
  const first = new Date(Date.UTC(year, number - 1, 1));
  const length = new Date(Date.UTC(year, number, 0)).getUTCDate();
  const count = Math.ceil((first.getUTCDay() + length) / 7) * 7;
  return Array.from({ length: count }, (_, index) => new Date(Date.UTC(year, number - 1, 1 - first.getUTCDay() + index)).toISOString().slice(0, 10));
}
export function shiftMonth(month: string, offset: number) {
  const [year, number] = month.split('-').map(Number);
  return new Date(Date.UTC(year, number - 1 + offset, 1)).toISOString().slice(0, 7);
}
export function nextDay(key: string) {
  return new Date(Date.parse(key + 'T12:00:00Z') + 86400000).toISOString().slice(0, 10);
}
export function csvCell(value: unknown) {
  let text = String(value ?? '');
  // Prevent exported names and notes from being interpreted as spreadsheet formulas.
  if (/^[\s]*[=+@-]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}
