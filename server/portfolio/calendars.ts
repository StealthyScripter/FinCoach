import type { PortfolioInstrument, PortfolioMarketStatus } from "./domain";

export function marketStatusForInstrument(instrument: Pick<PortfolioInstrument, "marketCalendar">, now = new Date()): PortfolioMarketStatus {
  if (instrument.marketCalendar === "US_EQUITY" || instrument.marketCalendar === "US_OPTIONS") return usMarketStatus(now, instrument.marketCalendar);
  return { market: instrument.marketCalendar, region: "unknown", primaryExchanges: [], status: "unknown", reason: "unsupported", observedAt: now.toISOString(), nextOpenAt: null, nextCloseAt: null, source: "portfolio-calendar" };
}

export function usMarketStatus(now = new Date(), calendar = "US_EQUITY"): PortfolioMarketStatus {
  const reason = usHolidayReason(now);
  const status = reason ? "closed" : isWithinSession(now) ? "open" : "closed";
  return { market: calendar, region: "United States", primaryExchanges: calendar === "US_OPTIONS" ? ["OPRA"] : ["NYSE", "NASDAQ"], status, reason: reason ? "holiday" : status === "open" ? "regular" : "outside_hours", observedAt: now.toISOString(), nextOpenAt: null, nextCloseAt: null, source: "portfolio-calendar" };
}

export function latestLegitimateClose(now = new Date()) {
  const cursor = new Date(now);
  for (let i = 0; i < 10; i += 1) {
    const close = sessionClose(cursor);
    if (close.getTime() <= now.getTime() && !usHolidayReason(close)) return close;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return sessionClose(now);
}

function isWithinSession(now: Date) {
  const day = now.getUTCDay();
  if (day === 0 || day === 6) return false;
  const open = new Date(now);
  open.setUTCHours(14, 30, 0, 0);
  const close = sessionClose(now);
  return now >= open && now < close;
}

function sessionClose(now: Date) {
  const close = new Date(now);
  close.setUTCHours(isEarlyClose(now) ? 18 : 21, 0, 0, 0);
  return close;
}

function isEarlyClose(now: Date) {
  const thanksgiving = nthWeekdayUtc(now.getUTCFullYear(), 10, 4, 4);
  const dayAfter = new Date(thanksgiving);
  dayAfter.setUTCDate(thanksgiving.getUTCDate() + 1);
  return sameUtcDay(now, dayAfter);
}

function usHolidayReason(now: Date) {
  const day = now.getUTCDay();
  if (day === 0 || day === 6) return "weekend";
  const year = now.getUTCFullYear();
  const fixed = [observedFixed(year, 0, 1), observedFixed(year, 6, 4), observedFixed(year, 11, 25)];
  if (fixed.some((date) => sameUtcDay(now, date))) return "holiday";
  if (sameUtcDay(now, nthWeekdayUtc(year, 10, 4, 4))) return "holiday";
  return null;
}

function observedFixed(year: number, month: number, date: number) {
  const value = new Date(Date.UTC(year, month, date, 21));
  if (value.getUTCDay() === 6) value.setUTCDate(value.getUTCDate() - 1);
  if (value.getUTCDay() === 0) value.setUTCDate(value.getUTCDate() + 1);
  return value;
}

function nthWeekdayUtc(year: number, month: number, weekday: number, nth: number) {
  const value = new Date(Date.UTC(year, month, 1, 21));
  let seen = 0;
  while (value.getUTCMonth() === month) {
    if (value.getUTCDay() === weekday) {
      seen += 1;
      if (seen === nth) return new Date(value);
    }
    value.setUTCDate(value.getUTCDate() + 1);
  }
  return value;
}

function sameUtcDay(a: Date, b: Date) {
  return a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth() && a.getUTCDate() === b.getUTCDate();
}
