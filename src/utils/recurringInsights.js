import RecurringTransaction from "../model/recurringTransaction.js";
import Transaction from "../model/transactions.js";
import { occurrencesBetween, skippedDays, toDayString } from "./dates.js";

// Average occurrences per month, to turn any frequency into "per month"
export const PER_MONTH = {
  daily: 365 / 12,
  weekly: 52 / 12,
  biweekly: 26 / 12,
  monthly: 1,
  quarterly: 1 / 3,
  halfyearly: 1 / 6,
  yearly: 1 / 12,
};

const DAY = 86400e3;
const UPCOMING_DAYS = 30;
const UPCOMING_LIMIT = 50; // items listed; totals count everything
const CHANGE_WINDOW_DAYS = 90; // how far back a price change is news
const round2 = (n) => Math.round(n * 100) / 100;

// Pure: payment dates of one rule from today through `until`
export function upcomingDates(rule, today, until) {
  // anything up to the last created payment (or yesterday) is history
  const yesterday = new Date(today.getTime() - 1);
  const after =
    rule.lastOccurrence && rule.lastOccurrence > yesterday
      ? rule.lastOccurrence
      : yesterday;
  const end =
    rule.endDate && rule.endDate < until
      ? new Date(new Date(rule.endDate).setUTCHours(23, 59, 59, 999))
      : until;
  const skipped = skippedDays(rule);
  return occurrencesBetween(
    rule.frequency,
    rule.startDate,
    after,
    end,
    400
  ).filter((d) => !skipped.has(toDayString(d)));
}

// Pure: the price change worth showing for one rule, or null.
// `payments` are the rule's transactions, newest first.
export function priceChange(rule, payments, now = new Date()) {
  if (!payments.length) return null;
  const pct = (from, to) => (from ? round2(((to - from) / from) * 100) : null);
  const last = payments[0];
  // the amount was edited: the next payment will differ from the last one
  if (rule.isActive && rule.nextOccurrence && rule.amount !== last.amount) {
    return {
      kind: "upcoming",
      from: last.amount,
      to: rule.amount,
      date: rule.nextOccurrence,
      percent: pct(last.amount, rule.amount),
    };
  }
  // the most recent payment that differs from the one before it
  for (let i = 0; i < payments.length - 1; i++) {
    const [newer, older] = [payments[i], payments[i + 1]];
    if (newer.amount === older.amount) continue;
    if (now - new Date(newer.date) > CHANGE_WINDOW_DAYS * DAY) return null;
    return {
      kind: "changed",
      from: older.amount,
      to: newer.amount,
      date: newer.date,
      percent: pct(older.amount, newer.amount),
    };
  }
  return null;
}

export async function recurringInsights(userId, now = new Date()) {
  const rules = await RecurringTransaction.find({ userId }).lean();
  const active = rules.filter((r) => r.isActive);

  const perMonth = (type) =>
    round2(
      active
        .filter((r) => r.type === type)
        .reduce((s, r) => s + r.amount * (PER_MONTH[r.frequency] ?? 0), 0)
    );

  const today = new Date(`${toDayString(now)}T00:00:00.000Z`);
  const until = new Date(today.getTime() + (UPCOMING_DAYS + 1) * DAY - 1);
  const upcoming = active
    .flatMap((r) =>
      upcomingDates(r, today, until).map((date) => ({
        ruleId: r._id,
        note: r.note,
        type: r.type,
        category: r.category,
        amount: r.amount,
        date,
      }))
    )
    .sort((a, b) => a.date - b.date);
  const upcomingTotal = (type) =>
    round2(
      upcoming.filter((u) => u.type === type).reduce((s, u) => s + u.amount, 0)
    );

  // Last 12 payments of every rule, newest first
  const history = rules.length
    ? await Transaction.aggregate([
        {
          $match: {
            userId,
            recurringTransactionId: { $in: rules.map((r) => r._id) },
          },
        },
        { $sort: { date: -1 } },
        {
          $group: {
            _id: "$recurringTransactionId",
            payments: { $push: { amount: "$amount", date: "$date" } },
          },
        },
        { $project: { payments: { $slice: ["$payments", 12] } } },
      ])
    : [];
  const paymentsOf = Object.fromEntries(
    history.map((h) => [String(h._id), h.payments])
  );
  const priceChanges = rules
    .map((r) => {
      const change = priceChange(r, paymentsOf[String(r._id)] || [], now);
      return change && { ruleId: r._id, note: r.note, type: r.type, ...change };
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  return {
    committed: {
      expense: perMonth("expense"),
      income: perMonth("income"),
      active: active.length,
      total: rules.length,
    },
    upcoming: {
      days: UPCOMING_DAYS,
      count: upcoming.length,
      expense: upcomingTotal("expense"),
      income: upcomingTotal("income"),
      items: upcoming.slice(0, UPCOMING_LIMIT),
    },
    priceChanges,
  };
}
