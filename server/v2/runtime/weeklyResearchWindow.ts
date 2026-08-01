import type { WeeklyResearchScheduleConfig } from "./config";

export type WeeklyResearchWindowReason =
  | "inside_weekly_window"
  | "inside_start_lead_window"
  | "weekend_closed"
  | "schedule_disabled"
  | "configuration_invalid";

export type WeeklyResearchWindowState = {
  timezone: string;
  now: string;
  isResearchWindowOpen: boolean;
  isStartLeadWindow: boolean;
  currentWindowOpenedAt: string | null;
  currentWindowClosesAt: string | null;
  nextWindowOpensAt: string;
  nextWindowClosesAt: string;
  reason: WeeklyResearchWindowReason;
};

export function weeklyResearchWindowState(config: WeeklyResearchScheduleConfig, now = new Date()): WeeklyResearchWindowState {
  if (!config.enabled) {
    const next = nextWindow(config, now);
    return {
      timezone: config.timezone,
      now: now.toISOString(),
      isResearchWindowOpen: true,
      isStartLeadWindow: false,
      currentWindowOpenedAt: next.open.toISOString(),
      currentWindowClosesAt: next.close.toISOString(),
      nextWindowOpensAt: next.open.toISOString(),
      nextWindowClosesAt: next.close.toISOString(),
      reason: "schedule_disabled",
    };
  }
  if (!validateWeeklyWindowConfig(config)) {
    const fallback = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
    return {
      timezone: config.timezone,
      now: now.toISOString(),
      isResearchWindowOpen: false,
      isStartLeadWindow: false,
      currentWindowOpenedAt: null,
      currentWindowClosesAt: null,
      nextWindowOpensAt: fallback,
      nextWindowClosesAt: fallback,
      reason: "configuration_invalid",
    };
  }
  const current = currentWindow(config, now);
  const leadStart = new Date(current.open.getTime() - config.startLeadMinutes * 60_000);
  const insideOpen = now.getTime() >= current.open.getTime() && now.getTime() < current.close.getTime();
  const insideLead = now.getTime() >= leadStart.getTime() && now.getTime() < current.open.getTime();
  if (insideOpen || insideLead) {
    return {
      timezone: config.timezone,
      now: now.toISOString(),
      isResearchWindowOpen: insideOpen,
      isStartLeadWindow: insideLead,
      currentWindowOpenedAt: current.open.toISOString(),
      currentWindowClosesAt: current.close.toISOString(),
      nextWindowOpensAt: current.open.toISOString(),
      nextWindowClosesAt: current.close.toISOString(),
      reason: insideOpen ? "inside_weekly_window" : "inside_start_lead_window",
    };
  }
  const next = nextWindow(config, now);
  return {
    timezone: config.timezone,
    now: now.toISOString(),
    isResearchWindowOpen: false,
    isStartLeadWindow: false,
    currentWindowOpenedAt: null,
    currentWindowClosesAt: null,
    nextWindowOpensAt: next.open.toISOString(),
    nextWindowClosesAt: next.close.toISOString(),
    reason: "weekend_closed",
  };
}

export function nextWeeklyTransitionAt(config: WeeklyResearchScheduleConfig, now = new Date()) {
  const state = weeklyResearchWindowState(config, now);
  if (!config.enabled || state.reason === "configuration_invalid") return null;
  if (state.isResearchWindowOpen) return state.currentWindowClosesAt;
  return state.nextWindowOpensAt;
}

export function weeklyTransitionId(kind: "open" | "close", boundaryIso: string) {
  return `weekly-research-session:${kind}:${boundaryIso}`;
}

export function formatInTimezone(date: Date | string, timezone: string, includeDate = true) {
  const value = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: includeDate ? "long" : undefined,
    year: includeDate ? "numeric" : undefined,
    month: includeDate ? "long" : undefined,
    day: includeDate ? "numeric" : undefined,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(value);
}

export function validateWeeklyWindowConfig(config: WeeklyResearchScheduleConfig) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: config.timezone }).format(new Date());
  } catch {
    return false;
  }
  return [config.openDay, config.closeDay].every((day) => Number.isInteger(day) && day >= 0 && day <= 6)
    && validTime(config.openTime)
    && validTime(config.closeTime)
    && Number.isInteger(config.startLeadMinutes)
    && config.startLeadMinutes >= 0
    && config.startLeadMinutes <= 1440;
}

function currentWindow(config: WeeklyResearchScheduleConfig, now: Date) {
  const parts = zonedParts(now, config.timezone);
  const weekStartUtc = Date.UTC(parts.year, parts.month - 1, parts.day - parts.weekday, 0, 0, 0);
  return windowFromWeekStart(config, weekStartUtc);
}

function nextWindow(config: WeeklyResearchScheduleConfig, now: Date) {
  const current = currentWindow(config, now);
  if (now.getTime() < current.close.getTime()) return current;
  return windowFromWeekStart(config, current.weekStartUtc + 7 * 24 * 60 * 60 * 1000);
}

function windowFromWeekStart(config: WeeklyResearchScheduleConfig, weekStartUtc: number) {
  const openLocal = localDateFromWeekStart(weekStartUtc, config.openDay, config.openTime);
  let closeLocal = localDateFromWeekStart(weekStartUtc, config.closeDay, config.closeTime);
  if (localComparable(closeLocal) <= localComparable(openLocal)) {
    closeLocal = localDateFromWeekStart(weekStartUtc + 7 * 24 * 60 * 60 * 1000, config.closeDay, config.closeTime);
  }
  return {
    weekStartUtc,
    open: zonedTimeToUtc(openLocal, config.timezone),
    close: zonedTimeToUtc(closeLocal, config.timezone),
  };
}

function localDateFromWeekStart(weekStartUtc: number, day: number, time: string) {
  const date = new Date(weekStartUtc + day * 24 * 60 * 60 * 1000);
  const [hour, minute] = time.split(":").map(Number);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate(), hour, minute };
}

function localComparable(value: { year: number; month: number; day: number; hour: number; minute: number }) {
  return Date.UTC(value.year, value.month - 1, value.day, value.hour, value.minute);
}

function zonedTimeToUtc(local: { year: number; month: number; day: number; hour: number; minute: number }, timezone: string) {
  const target = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, 0);
  let guess = target;
  for (let index = 0; index < 4; index += 1) {
    const parts = zonedParts(new Date(guess), timezone);
    const actual = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0);
    const diff = actual - target;
    if (diff === 0) break;
    guess -= diff;
  }
  return new Date(guess);
}

function zonedParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    weekday: ({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 } as Record<string, number>)[String(values.weekday)] ?? 0,
    hour: Number(values.hour),
    minute: Number(values.minute),
  };
}

function validTime(value: string) {
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(value);
}
