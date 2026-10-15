import Transaction from "../model/transactions.js";
import RecurringTransaction from "../model/recurringTransaction.js";
import { occurrencesBetween, skippedDays, toDayString } from "./dates.js";

const round = (n) => Math.round(n * 100) / 100;

/**
 * Month-end forecast for the current (UTC) month:
 *   left = income so far + recurring income still due
 *        - spending so far - daily pace x days left - recurring expenses due
 *        - saved to goals
 * The daily pace uses non-recurring spending only, so a rent payment on
 * the 2nd doesn't get multiplied across the month.
 */
export async function monthForecast(userId, now = new Date()) {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth(); // 0-11
  const start = new Date(Date.UTC(year, month, 1));
  const end = new Date(Date.UTC(year, month + 1, 1));
  const daysInMonth = Math.round((end - start) / 86400e3);
  const daysElapsed = now.getUTCDate();
  const daysLeft = daysInMonth - daysElapsed;
  const todayEnd = new Date(
    Date.UTC(year, month, daysElapsed, 23, 59, 59, 999)
  );

  const txns = await Transaction.find({
    userId,
    date: { $gte: start, $lt: end },
  }).lean();
  let income = 0;
  let spent = 0;
  let saved = 0;
  let variableSpent = 0;
  for (const t of txns) {
    if (t.type === "income" || t.type === "credit") income += t.amount;
    else if (t.category === "goal") saved += t.amount;
    else if (t.type === "expense") {
      spent += t.amount;
      if (!t.isRecurring) variableSpent += t.amount;
    }
  }
  const dailyPace = variableSpent / Math.max(daysElapsed, 1);
  const projectedVariable = dailyPace * daysLeft;

  // Recurring payments still to come this month (after today)
  const rules = await RecurringTransaction.find({
    userId,
    isActive: true,
  }).lean();
  const upcoming = [];
  for (const rule of rules) {
    const after = new Date(
      Math.max(todayEnd, new Date(rule.lastOccurrence || rule.startDate))
    );
    const until = rule.endDate
      ? new Date(
          Math.min(end - 1, new Date(rule.endDate).getTime() + 86400e3 - 1)
        )
      : new Date(end - 1);
    const skipped = skippedDays(rule);
    for (const date of occurrencesBetween(
      rule.frequency,
      rule.startDate,
      after,
      until,
      40
    )) {
      if (skipped.has(toDayString(date))) continue;
      upcoming.push({
        note: rule.note,
        amount: rule.amount,
        type: rule.type,
        date,
      });
    }
  }
  upcoming.sort((a, b) => a.date - b.date);
  const upcomingIncome = upcoming
    .filter((u) => u.type === "income")
    .reduce((s, u) => s + u.amount, 0);
  const upcomingExpenses = upcoming
    .filter((u) => u.type === "expense")
    .reduce((s, u) => s + u.amount, 0);

  const projectedSpending = spent + projectedVariable + upcomingExpenses;
  const projectedIncome = income + upcomingIncome;
  return {
    year,
    month: month + 1,
    daysElapsed,
    daysLeft,
    daysInMonth,
    income: round(income),
    spent: round(spent),
    saved: round(saved),
    dailyPace: round(dailyPace),
    projectedVariable: round(projectedVariable),
    upcoming: upcoming.map((u) => ({
      ...u,
      amount: round(u.amount),
      date: toDayString(u.date),
    })),
    upcomingIncome: round(upcomingIncome),
    upcomingExpenses: round(upcomingExpenses),
    projectedIncome: round(projectedIncome),
    projectedSpending: round(projectedSpending),
    projectedLeft: round(projectedIncome - projectedSpending - saved),
    // fewer than 5 days of data: the pace is a rough guess
    roughEstimate: daysElapsed < 5,
  };
}
