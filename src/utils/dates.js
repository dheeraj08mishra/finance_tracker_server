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
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// ---------- recurrence ----------
const UNITS = {
  minutely: [addMinutes, differenceInMinutes],
  daily: [addDays, differenceInDays],
  weekly: [addWeeks, differenceInWeeks],
  monthly: [addMonths, differenceInMonths],
  yearly: [addYears, differenceInYears],
};

// Occurrences are always counted from startDate (start + k * step), so a
// rule starting on the 31st stays on month-end instead of drifting to the 28th.
export function occurrencesBetween(frequency, startDate, after, until, limit = 100) {
  const unit = UNITS[frequency];
  if (!unit) return [];
  const [add, diff] = unit;
  // Accept strings or Dates (comparing a Date with a string is always false)
  const start = new Date(startDate);
  after = new Date(after);
  until = new Date(until);
  if ([start, after, until].some((d) => isNaN(d))) return [];
  // Jump close to `after` instead of walking from the start
  let k = Math.max(1, diff(after, start) - 1);
  const result = [];
  while (result.length < limit) {
    const date = add(start, k);
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
