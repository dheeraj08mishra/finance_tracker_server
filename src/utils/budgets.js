import Transaction from "../model/transactions.js";

export const BUDGET_CATEGORIES = ["need", "want", "investment", "other"];
export const WARN_AT = 80; // percent of a budget that triggers a warning

const monthRange = (year, month) => ({
  $gte: new Date(Date.UTC(year, month - 1, 1)),
  $lt: new Date(Date.UTC(year, month, 1)),
});

const levelOf = (percent) =>
  percent === null
    ? "none"
    : percent >= 100
      ? "over"
      : percent >= WARN_AT
        ? "warning"
        : "ok";

/**
 * Spending vs budget per category for one month (month is 1-12).
 * Goal contributions are savings, not spending, so they never count.
 */
export async function budgetStatus(user, year, month) {
  const rows = await Transaction.aggregate([
    {
      $match: {
        userId: user._id,
        type: "expense",
        category: { $in: BUDGET_CATEGORIES },
        date: monthRange(year, month),
      },
    },
    { $group: { _id: "$category", total: { $sum: "$amount" } } },
  ]);
  const spentBy = Object.fromEntries(rows.map((r) => [r._id, r.total]));
  return BUDGET_CATEGORIES.map((category) => {
    const limit = user.budgets?.[category] ?? null;
    const spent = Math.round((spentBy[category] || 0) * 100) / 100;
    const percent = limit ? Math.round((spent / limit) * 100) : null;
    return { category, limit, spent, percent, level: levelOf(percent) };
  });
}
