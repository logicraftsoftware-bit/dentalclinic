function parts(date: Date, zone: string) {
  return Object.fromEntries(
    new Intl.DateTimeFormat('en-CA-u-ca-gregory-nu-latn', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .filter((p) => p.type !== 'literal')
      .map((p) => [p.type, Number(p.value)]),
  );
}
export function dateKey(date: Date, zone: string) {
  const p = parts(date, zone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}
export function midnight(key: string, zone: string) {
  const [year, month, day] = key.split('-').map(Number);
  const wall = Date.UTC(year, month - 1, day);
  let instant = wall;
  for (let i = 0; i < 3; i++) {
    const p = parts(new Date(instant), zone);
    const offset = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - instant;
    instant = wall - offset;
  }
  return new Date(instant);
}
export function zonedDayRange(now: Date, zone: string) {
  const key = dateKey(now, zone);
  const [year, month, day] = key.split('-').map(Number);
  const tomorrow = new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
  return { gte: midnight(key, zone), lt: midnight(tomorrow, zone) };
}
