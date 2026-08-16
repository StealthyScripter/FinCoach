import { ACCOUNTING_BOUNDARY_HOUR_UTC, ACCOUNTING_TIMEZONE, addLocalDays, formatPeriodPresentation, localParts, presentationTimezone } from "./timeService";

export type AccountingPeriodType = "daily" | "weekly" | "monthly" | "yearly";

export type AccountingPeriod = {
  type: AccountingPeriodType;
  startUtc: string;
  endUtc: string;
  presentationStart: string;
  presentationEnd: string;
  presentationPeriod: string;
  accountingTimezone: typeof ACCOUNTING_TIMEZONE;
  presentationTimezone: string;
};

export function accountingPeriod(type: AccountingPeriodType, now = new Date(), displayTimezone = presentationTimezone()): AccountingPeriod {
  const range = type === "daily"
    ? dailyAccountingRange(now)
    : type === "weekly"
      ? weeklyAccountingRange(now)
      : type === "monthly"
        ? monthlyAccountingRange(now)
        : yearlyAccountingRange(now);
  return {
    type,
    startUtc: range.start.toISOString(),
    endUtc: range.end.toISOString(),
    presentationStart: formatPeriodBoundary(range.start, displayTimezone),
    presentationEnd: formatPeriodBoundary(range.end, displayTimezone),
    presentationPeriod: formatPeriodPresentation(range.start.toISOString(), range.end.toISOString(), displayTimezone),
    accountingTimezone: ACCOUNTING_TIMEZONE,
    presentationTimezone: displayTimezone,
  };
}

export function adjacentAccountingPeriods(type: AccountingPeriodType, now = new Date(), displayTimezone = presentationTimezone()) {
  const current = accountingPeriod(type, now, displayTimezone);
  const previousInstant = new Date(Date.parse(current.startUtc) - 1);
  const nextInstant = new Date(Date.parse(current.endUtc));
  return {
    previous: accountingPeriod(type, previousInstant, displayTimezone),
    current,
    next: accountingPeriod(type, nextInstant, displayTimezone),
  };
}

function dailyAccountingRange(now: Date) {
  let startDate = utcDateKey(now);
  if (now.getUTCHours() < ACCOUNTING_BOUNDARY_HOUR_UTC) startDate = addLocalDays(startDate, -1);
  const endDate = addLocalDays(startDate, 1);
  return { start: boundaryUtc(startDate), end: boundaryUtc(endDate) };
}

function weeklyAccountingRange(now: Date) {
  const dayKey = utcDateKey(now);
  let sundayKey = addLocalDays(dayKey, -now.getUTCDay());
  if (now.getTime() < boundaryUtc(sundayKey).getTime()) sundayKey = addLocalDays(sundayKey, -7);
  const fridayKey = addLocalDays(sundayKey, 5);
  return { start: boundaryUtc(sundayKey), end: boundaryUtc(fridayKey) };
}

function monthlyAccountingRange(now: Date) {
  const day = dailyAccountingRange(now).start;
  const parts = localParts(day, ACCOUNTING_TIMEZONE);
  const startKey = `${parts.year}-${String(parts.month).padStart(2, "0")}-01`;
  const nextMonth = parts.month === 12 ? { year: parts.year + 1, month: 1 } : { year: parts.year, month: parts.month + 1 };
  const nextKey = `${nextMonth.year}-${String(nextMonth.month).padStart(2, "0")}-01`;
  // Monthly P/L aggregates accounting days whose fixed 21:00 UTC start date falls in the calendar month.
  return { start: boundaryUtc(startKey), end: boundaryUtc(nextKey) };
}

function yearlyAccountingRange(now: Date) {
  const day = dailyAccountingRange(now).start;
  const parts = localParts(day, ACCOUNTING_TIMEZONE);
  return { start: boundaryUtc(`${parts.year}-01-01`), end: boundaryUtc(`${parts.year + 1}-01-01`) };
}

function boundaryUtc(localDate: string) {
  return new Date(`${localDate}T${String(ACCOUNTING_BOUNDARY_HOUR_UTC).padStart(2, "0")}:00:00.000Z`);
}

export function accountingDateKey(now = new Date()) {
  return dailyAccountingRange(now).start.toISOString().slice(0, 10);
}

function utcDateKey(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function formatPeriodBoundary(date: Date, timezone: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    month: "short",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZoneName: "short",
  }).format(date);
}
