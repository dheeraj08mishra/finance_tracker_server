import { addDays } from "date-fns";
import User from "../model/user.js";
import Transaction from "../model/transactions.js";
import RecurringTransaction from "../model/recurringTransaction.js";
import { budgetStatus } from "./budgets.js";
import { MONTH_NAMES } from "./dates.js";
import {
  sendBudgetAlertEmail,
  sendMonthlySummaryEmail,
  sendRecurringTransactionEmail,
} from "./autoEmail/mailer.js";

// Notifications are on unless the user switched them off
export const wants = (user, kind) => user?.notifications?.[kind] !== false;

const monthKey = (year, month) => `${year}-${String(month).padStart(2, "0")}`;

/**
 * Email a budget alert once per level ("warning" at 80%, "over" at 100%)
 * per category per month. The "already sent" check is one atomic update,
 * so two quick expenses can't send the same alert twice.
 * Returns true when an email was sent.
 */
export async function notifyBudgetAlert(user, row, year, month) {
  if (!row || (row.level !== "warning" && row.level !== "over")) return false;
  if (!wants(user, "budgetAlerts")) return false;
  const key = `budgetAlertsSent.${monthKey(year, month)}:${row.category}`;
  // warning: only if nothing sent yet; over: unless "over" was already sent
  const notYet =
    row.level === "warning"
      ? { [key]: { $exists: false } }
      : { [key]: { $ne: "over" } };
  const claimed = await User.updateOne(
    { _id: user._id, ...notYet },
    { $set: { [key]: row.level } }
  );
  if (!claimed.modifiedCount) return false;
  try {
    await sendBudgetAlertEmail(user, row, `${MONTH_NAMES[month - 1]} ${year}`);
  } catch (err) {
    console.error("[EMAIL] budget alert failed:", err.message);
  }
  return true;
}

// Check one category for one month and alert if needed
export async function checkBudget(user, category, year, month) {
  if (!user?.budgets?.[category]) return false;
  const row = (await budgetStatus(user, year, month)).find(
    (r) => r.category === category
  );
  return notifyBudgetAlert(user, row, year, month);
}

/**
 * Monthly summary for every user who wants one and had activity that
 * month (month is 1-12). Returns { sent, skipped }.
 */
export async function sendMonthlySummaries(year, month) {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));
  const prevStart = new Date(Date.UTC(year, month - 2, 1));
  let sent = 0;
  let skipped = 0;

  const activeUserIds = await Transaction.distinct("userId", {
    date: { $gte: start, $lt: end },
  });
  for (const userId of activeUserIds) {
    const user = await User.findById(userId);
    if (!user || !wants(user, "monthlySummary")) {
      skipped++;
      continue;
    }
    const totals = await Transaction.aggregate([
      { $match: { userId, date: { $gte: prevStart, $lt: end } } },
      {
        $group: {
          _id: {
            current: { $gte: ["$date", start] },
            kind: {
              $cond: [
                { $in: ["$type", ["income", "credit"]] },
                "income",
                {
                  $cond: [{ $eq: ["$category", "goal"] }, "saved", "spending"],
                },
              ],
            },
            category: "$category",
          },
          total: { $sum: "$amount" },
        },
      },
    ]);
    const sum = (current, kind) =>
      totals
        .filter((t) => t._id.current === current && t._id.kind === kind)
        .reduce((s, t) => s + t.total, 0);
    const topCategories = totals
      .filter((t) => t._id.current && t._id.kind === "spending")
      .map((t) => ({ category: t._id.category, total: t.total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 3);

    try {
      await sendMonthlySummaryEmail(user, {
        monthLabel: `${MONTH_NAMES[month - 1]} ${year}`,
        income: sum(true, "income"),
        spending: sum(true, "spending"),
        saved: sum(true, "saved"),
        previousSpending: sum(false, "spending"),
        topCategories,
        budgets: await budgetStatus(user, year, month),
      });
      sent++;
    } catch (err) {
      console.error(`[EMAIL] summary for ${user.email} failed:`, err.message);
      skipped++;
    }
  }
  return { sent, skipped };
}

// Email users about recurring payments due tomorrow (UTC day)
export async function sendTomorrowReminders() {
  const tomorrowStart = addDays(new Date(), 1);
  tomorrowStart.setUTCHours(0, 0, 0, 0);
  const tomorrowEnd = new Date(tomorrowStart);
  tomorrowEnd.setUTCHours(23, 59, 59, 999);

  const due = await RecurringTransaction.find({
    isActive: true,
    nextOccurrence: { $gte: tomorrowStart, $lte: tomorrowEnd },
  });
  let sent = 0;
  for (const rule of due) {
    const user = await User.findById(rule.userId);
    if (!user?.email || !wants(user, "recurringReminders")) continue;
    try {
      await sendRecurringTransactionEmail(
        user.email,
        {
          amount: rule.amount,
          category: rule.category,
          note: rule.note,
          date: rule.nextOccurrence,
        },
        true
      );
      sent++;
    } catch (err) {
      console.error(
        `[EMAIL] reminder for rule=${rule._id} failed:`,
        err.message
      );
    }
  }
  return { due: due.length, sent };
}
