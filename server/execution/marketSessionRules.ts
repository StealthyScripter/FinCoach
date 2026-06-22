import { z } from "zod";

export const marketSessionAssetClassSchema = z.enum(["forex", "commodity", "equity"]);

export const marketSessionRulesInputSchema = z.object({
  assetClass: marketSessionAssetClassSchema,
  now: z.date().optional(),
  positionHeldOvernight: z.boolean().default(false),
  financingAcknowledged: z.boolean().default(false),
  accountEquity: z.number().positive(),
  currentMarginUsed: z.number().nonnegative(),
  projectedMarginUsed: z.number().nonnegative(),
});

export type MarketSessionRulesInput = z.infer<typeof marketSessionRulesInputSchema>;

type MarketSessionRuleCheck = {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
  requiredAction?: string;
};

export class MarketSessionRulesService {
  evaluate(input: MarketSessionRulesInput) {
    const parsed = marketSessionRulesInputSchema.parse(input);
    const now = parsed.now ?? new Date();
    const eastern = getEasternMoment(now);
    const holiday = isUsMarketHoliday(eastern.year, eastern.month, eastern.day);
    const marketHoursOpen = this.marketHoursOpen(parsed.assetClass, eastern);
    const rolloverWindowActive = parsed.assetClass === "forex" && eastern.weekday === 5 && (eastern.hour > 17 || (eastern.hour === 17 && eastern.minute >= 0));
    const financingRequired = parsed.assetClass === "forex" && parsed.positionHeldOvernight;
    const projectedMarginUsagePct = parsed.accountEquity > 0 ? parsed.projectedMarginUsed / parsed.accountEquity * 100 : 100;
    const currentMarginUsagePct = parsed.accountEquity > 0 ? parsed.currentMarginUsed / parsed.accountEquity * 100 : 100;

    const checks: MarketSessionRuleCheck[] = [
      check("market_hours", marketHoursOpen, this.marketHoursLabel(parsed.assetClass, eastern), this.marketHoursAction(parsed.assetClass)),
      check("holiday", !holiday, holidayLabel(eastern), "Avoid execution on the market holiday"),
      check("rollover", !rolloverWindowActive, "Forex rollover window is closed", "Avoid initiating forex exposure at the broker cutoff"),
      check("financing", !financingRequired || parsed.financingAcknowledged, financingRequired
        ? "Overnight financing has been acknowledged"
        : "No overnight financing applies", "Acknowledge overnight financing before holding forex positions across the cutoff"),
      check("margin_call", projectedMarginUsagePct < 80, `Projected margin usage is ${projectedMarginUsagePct.toFixed(2)}%`, "Reduce size or add equity before taking the trade"),
      check("liquidation", projectedMarginUsagePct < 95 && currentMarginUsagePct < 95, `Projected margin usage remains below the liquidation threshold`, "Reduce position size well below liquidation thresholds"),
    ];

    const requiredActions = checks.filter((item) => !item.passed && item.requiredAction).map((item) => item.requiredAction as string);
    const allowed = requiredActions.length === 0;
    const phase = !marketHoursOpen
      ? "market_closed"
      : holiday
        ? "holiday_closed"
        : rolloverWindowActive
          ? "rollover_window"
          : projectedMarginUsagePct >= 95 || currentMarginUsagePct >= 95
            ? "liquidation_alert"
            : projectedMarginUsagePct >= 80
              ? "margin_alert"
              : "open";

    return {
      allowed,
      phase,
      checks,
      requiredActions,
      marketHoursOpen,
      holiday,
      rolloverWindowActive,
      financingRequired,
      projectedMarginUsagePct: round(projectedMarginUsagePct),
      currentMarginUsagePct: round(currentMarginUsagePct),
      generatedAt: now.toISOString(),
    };
  }

  private marketHoursOpen(assetClass: z.infer<typeof marketSessionAssetClassSchema>, eastern: EasternMoment) {
    if (isUsMarketHoliday(eastern.year, eastern.month, eastern.day)) return false;
    if (assetClass === "equity") return isWeekday(eastern.weekday) && after(eastern, 9, 30) && before(eastern, 16, 0);
    if (assetClass === "commodity") {
      if (eastern.weekday === 0) return after(eastern, 18, 0);
      if (eastern.weekday === 6) return false;
      if (eastern.weekday === 5) return before(eastern, 17, 0);
      return !(afterOrEqual(eastern, 17, 0) && before(eastern, 18, 0));
    }
    if (eastern.weekday === 0) return after(eastern, 17, 0);
    if (eastern.weekday === 6) return false;
    if (eastern.weekday === 5) return before(eastern, 17, 0);
    return true;
  }

  private marketHoursLabel(assetClass: z.infer<typeof marketSessionAssetClassSchema>, eastern: EasternMoment) {
    const open = this.marketHoursOpen(assetClass, eastern);
    return open ? `${assetClass} market hours are open` : `${assetClass} market hours are closed`;
  }

  private marketHoursAction(assetClass: z.infer<typeof marketSessionAssetClassSchema>) {
    if (assetClass === "equity") return "Wait for the regular equity session";
    if (assetClass === "commodity") return "Wait for the commodity session to reopen after maintenance";
    return "Wait for the forex session to reopen";
  }
}

type EasternMoment = {
  year: number;
  month: number;
  day: number;
  weekday: number;
  hour: number;
  minute: number;
};

function getEasternMoment(now: Date): EasternMoment {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    weekday: weekdayToNumber(String(values.weekday ?? "")),
    hour: Number(values.hour),
    minute: Number(values.minute),
  };
}

function weekdayToNumber(value: string) {
  return ({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 } as Record<string, number>)[value] ?? 0;
}

function isWeekday(weekday: number) {
  return weekday >= 1 && weekday <= 5;
}

function after(moment: EasternMoment, hour: number, minute: number) {
  return moment.hour > hour || (moment.hour === hour && moment.minute > minute);
}

function afterOrEqual(moment: EasternMoment, hour: number, minute: number) {
  return moment.hour > hour || (moment.hour === hour && moment.minute >= minute);
}

function before(moment: EasternMoment, hour: number, minute: number) {
  return moment.hour < hour || (moment.hour === hour && moment.minute < minute);
}

function check(id: string, passed: boolean, detail: string, requiredAction: string): MarketSessionRuleCheck {
  return { id, label: id.replaceAll("_", " "), passed, detail, requiredAction: passed ? undefined : requiredAction };
}

function holidayLabel(eastern: EasternMoment) {
  return `${eastern.month}/${eastern.day}/${eastern.year} is a market holiday`;
}

function isUsMarketHoliday(year: number, month: number, day: number) {
  const key = `${month}-${day}`;
  if (["1-1", "7-4", "12-25"].includes(key)) return true;
  if (isNthWeekdayOfMonth(year, month, day, 4, 4, 11)) return true;
  if (isNthWeekdayOfMonth(year, month, day, 1, 1, 9)) return true;
  if (isLastWeekdayOfMonth(year, month, day, 1, 5)) return true;
  if (isLastWeekdayOfMonth(year, month, day, 1, 11)) return true;
  return false;
}

function isNthWeekdayOfMonth(year: number, month: number, day: number, nth: number, weekday: number, monthIndex: number) {
  return month === monthIndex && day === nthWeekdayOfMonth(year, monthIndex, nth, weekday);
}

function isLastWeekdayOfMonth(year: number, month: number, day: number, weekday: number, monthIndex: number) {
  return month === monthIndex && day === lastWeekdayOfMonth(year, monthIndex, weekday);
}

function nthWeekdayOfMonth(year: number, monthIndex: number, nth: number, weekday: number) {
  let count = 0;
  const daysInMonth = new Date(Date.UTC(year, monthIndex, 0)).getUTCDate();
  for (let day = 1; day <= daysInMonth; day += 1) {
    const current = new Date(Date.UTC(year, monthIndex - 1, day));
    if (current.getUTCDay() === weekday) {
      count += 1;
      if (count === nth) return day;
    }
  }
  return -1;
}

function lastWeekdayOfMonth(year: number, monthIndex: number, weekday: number) {
  const daysInMonth = new Date(Date.UTC(year, monthIndex, 0)).getUTCDate();
  for (let day = daysInMonth; day >= 1; day -= 1) {
    const current = new Date(Date.UTC(year, monthIndex - 1, day));
    if (current.getUTCDay() === weekday) return day;
  }
  return -1;
}

function round(value: number) {
  return Number(value.toFixed(2));
}

export const marketSessionRulesService = new MarketSessionRulesService();
