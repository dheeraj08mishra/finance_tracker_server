import {
  addMinutes,
  addDays,
  addWeeks,
  addMonths,
  addYears,
  differenceInMinutes,
  differenceInDays,
  differenceInWeeks,
  differenceInMonths,
  differenceInYears,
} from "date-fns";

// ---------- calendar days ----------
// Transaction dates are calendar days stored as UTC midnight ("2026-10-15").

export const toDayString = (date) => new Date(date).toISOString().slice(0, 10);

// The latest calendar date anywhere on Earth (UTC+14). A user ahead of UTC
// (e.g. IST just after midnight) must be able to use their own "today".
export const latestTodayString = () =>
  toDayString(Date.now() + 14 * 60 * 60 * 1000);

// The earliest calendar date anywhere on Earth (UTC-12)
export const earliestTodayString = () =>
  toDayString(Date.now() - 12 * 60 * 60 * 1000);

export const isFutureDay = (date) => toDayString(date) > latestTodayString();

export const dayRange = (date) => {
  const start = new Date(`${toDayString(date)}T00:00:00.000Z`);
  return { $gte: start, $lt: addDays(start, 1) };
};

export const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

// ---------- recurrence ----------
// [add, difference, step]: an occurrence is start + k * step units
const UNITS = {
  minutely: [addMinutes, differenceInMinutes, 1],
  daily: [addDays, differenceInDays, 1],
  weekly: [addWeeks, differenceInWeeks, 1],
  biweekly: [addWeeks, differenceInWeeks, 2],
  monthly: [addMonths, differenceInMonths, 1],
  quarterly: [addMonths, differenceInMonths, 3],
  halfyearly: [addMonths, differenceInMonths, 6],
  yearly: [addYears, differenceInYears, 1],
};

// Frequencies users may pick ("minutely" exists only for testing)
export const USER_FREQUENCIES = [
  "daily",
  "weekly",
  "biweekly",
  "monthly",
  "quarterly",
  "halfyearly",
  "yearly",
];
export const ALL_FREQUENCIES = Object.keys(UNITS);

// Occurrences are always counted from startDate (start + k * step), so a
// rule starting on the 31st stays on month-end instead of drifting to the 28th.
export function occurrencesBetween(
  frequency,
  startDate,
  after,
  until,
  limit = 100
) {
  const unit = UNITS[frequency];
  if (!unit) return [];
  const [add, diff, step] = unit;
  // Accept strings or Dates (comparing a Date with a string is always false)
  const start = new Date(startDate);
  after = new Date(after);
  until = new Date(until);
  if ([start, after, until].some((d) => isNaN(d))) return [];
  // Jump close to `after` instead of walking from the start
  let k = Math.max(1, Math.floor(diff(after, start) / step) - 1);
  const result = [];
  while (result.length < limit) {
    const date = add(start, k * step);
    if (date > until) break;
    if (date > after) result.push(date);
    k++;
  }
  return result;
}

const FAR_FUTURE = new Date(8.64e15);

// First occurrence strictly after `after`
export const nextOccurrenceAfter = (frequency, startDate, after) =>
  occurrencesBetween(frequency, startDate, after, FAR_FUTURE, 1)[0] ?? null;

// Calendar days the user chose to skip, as "YYYY-MM-DD"
export const skippedDays = (rule) =>
  new Set((rule.skipDates || []).map((d) => toDayString(d)));

// Next occurrence after `after` that the user hasn't skipped
export function nextActiveOccurrence(rule, after) {
  const skipped = skippedDays(rule);
  let next = nextOccurrenceAfter(rule.frequency, rule.startDate, after);
  for (let i = 0; next && skipped.has(toDayString(next)) && i < 100; i++) {
    next = nextOccurrenceAfter(rule.frequency, rule.startDate, next);
  }
  return next;
}
