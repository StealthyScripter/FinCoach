export const DEFAULT_PRESENTATION_TIMEZONE = "America/New_York";
export const ACCOUNTING_TIMEZONE = "UTC";
export const ACCOUNTING_BOUNDARY_HOUR_UTC = 21;
export const ACCOUNTING_BOUNDARY_LABEL = "21:00 UTC";

export function presentationTimezone(env: NodeJS.ProcessEnv = process.env) {
  return validIanaTimezone(env.FINCOACH_PRESENTATION_TIMEZONE) ? env.FINCOACH_PRESENTATION_TIMEZONE!.trim() : DEFAULT_PRESENTATION_TIMEZONE;
}

export function validIanaTimezone(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value.trim() }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

export function utcNow() {
  return new Date().toISOString();
}

export function formatPresentation(value: string | Date, timezone = presentationTimezone(), includeZone = true) {
  const date = value instanceof Date ? value : new Date(value);
  const options: Intl.DateTimeFormatOptions = {
    timeZone: timezone,
    month: "short",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  };
  if (includeZone) options.timeZoneName = "short";
  return new Intl.DateTimeFormat("en-US", options).format(date);
}

export function formatPeriodPresentation(startUtc: string, endUtc: string, timezone = presentationTimezone()) {
  return `${formatPresentation(startUtc, timezone)} -> ${formatPresentation(endUtc, timezone)}`;
}

export function localParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    weekday: ({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 } as Record<string, number>)[String(values.weekday)] ?? 0,
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
  };
}

export function localDateKey(date: Date, timezone: string) {
  const parts = localParts(date, timezone);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function zonedTimeToUtc(localIso: string, timezone: string) {
  const [date, time] = localIso.split("T");
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute = 0, second = 0] = time.split(":").map(Number);
  let guess = Date.UTC(year, month - 1, day, hour, minute, second);
  for (let i = 0; i < 6; i += 1) {
    const parts = localParts(new Date(guess), timezone);
    const actual = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    const target = Date.UTC(year, month - 1, day, hour, minute, second);
    const delta = target - actual;
    if (delta === 0) break;
    guess += delta;
  }
  return new Date(guess);
}

export function addLocalDays(dateKey: string, days: number) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}-${String(shifted.getUTCDate()).padStart(2, "0")}`;
}

export function compareInstantToUtcRange(instant: string | Date, startUtc: string, endUtc: string) {
  const value = instant instanceof Date ? instant.getTime() : Date.parse(instant);
  return value >= Date.parse(startUtc) && value < Date.parse(endUtc);
}
