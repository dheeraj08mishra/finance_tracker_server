import express from "express";
import { publicError, errorStatus } from "../utils/errors.js";
import Transaction from "../model/transactions.js";
import userAuth from "../middleware/auth.js";
import { monthForecast } from "../utils/forecast.js";

const insightRouter = new express.Router();

// Get monthly income and expense summary
const MonthList = {
  1: "January",
  2: "February",
  3: "March",
  4: "April",
  5: "May",
  6: "June",
  7: "July",
  8: "August",
  9: "September",
  10: "October",
  11: "November",
  12: "December",
};

// Monthly income / spending / savings for a user (optionally one year).
// Goal contributions are savings, not spending; "credit" counts as income.
async function monthlySummary(
  userId,
  { year, sortYears = -1, sortMonths = 1 } = {}
) {
  const months = await Transaction.aggregate([
    {
      $match: {
        userId,
        ...(year && {
          date: {
            $gte: new Date(Date.UTC(year, 0, 1)),
            $lt: new Date(Date.UTC(year + 1, 0, 1)),
          },
        }),
      },
    },
    {
      $group: {
        _id: { year: { $year: "$date" }, month: { $month: "$date" } },
        income: {
          $sum: {
            $cond: [{ $in: ["$type", ["income", "credit"]] }, "$amount", 0],
          },
        },
        expense: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $eq: ["$type", "expense"] },
                  { $ne: ["$category", "goal"] },
                ],
              },
              "$amount",
              0,
            ],
          },
        },
        savings: {
          $sum: { $cond: [{ $eq: ["$category", "goal"] }, "$amount", 0] },
        },
      },
    },
    { $sort: { "_id.year": sortYears, "_id.month": sortMonths } },
  ]);
  return months.map(({ _id, income, expense, savings }) => ({
    year: _id.year,
    month: MonthList[_id.month],
    monthNumber: _id.month,
    income,
    expense,
    savings,
  }));
}

// Number from the request body, or the default when missing/blank
const numberOr = (value, fallback) =>
  value === undefined || value === null || value === "" || isNaN(value)
    ? fallback
    : Number(value);

insightRouter.get("/monthlySummary", userAuth, async (req, res) => {
  try {
    const summary = await monthlySummary(req.user._id, { sortMonths: -1 });
    res.json({ success: true, summary });
  } catch (error) {
    res
      .status(errorStatus(error))
      .json({ error: "Something went wrong", details: publicError(error) });
  }
});

// filter on year

insightRouter.post("/monthlySummary", userAuth, async (req, res) => {
  try {
    const year = Number(req.body.year);
    if (!Number.isInteger(year) || year < 1970 || year > 2100) {
      return res.status(400).json({ error: "Invalid year provided" });
    }
    const summary = await monthlySummary(req.user._id, { year });
    res.json({ success: true, summary });
  } catch (error) {
    res
      .status(errorStatus(error))
      .json({ error: "Something went wrong", details: publicError(error) });
  }
});

insightRouter.post("/anomalyDetection", userAuth, async (req, res) => {
  try {
    const userId = req.user._id;
    let { thresholdPercent, year, method, zThreshold, minAmount } = req.body;

    // Defaults: flag a month when spending moves 20%+ and by at least ₹500
    const threshold = numberOr(thresholdPercent, 20);
    if (threshold < 0 || threshold > 100) {
      return res
        .status(400)
        .json({ error: "Threshold percent must be between 0 and 100" });
    }

    zThreshold = numberOr(zThreshold, 1);
    if (zThreshold <= 0) {
      return res
        .status(400)
        .json({ error: "Z-Score threshold must be positive" });
    }

    minAmount = numberOr(minAmount, 500);
    // Oldest first: rolling/previous comparisons walk forward in time
    const filteredSummary = await monthlySummary(userId, {
      year: year ? Number(year) : undefined,
      sortYears: 1,
    });

    if (filteredSummary.length === 0) {
      return res
        .status(404)
        .json({ error: "No transactions found", anomalies: [] });
    }

    let results = [];

    // Auto-pick method
    if (filteredSummary.length <= 3) {
      method = "previous";
    } else if (!method) {
      method = "rollingAvg";
    }

    if (method === "rollingAvg") {
      for (let i = 0; i < filteredSummary.length; i++) {
        const current = filteredSummary[i];
        const window = filteredSummary.slice(Math.max(0, i - 3), i);
        if (window.length === 0) {
          results.push({
            ...current,
            anomaly: "normal",
            rollingAvg: null,
            percentChange: 0,
            method,
          });
          continue;
        }

        const rollingAvg =
          window.reduce((sum, x) => sum + x.expense, 0) / window.length;
        const percentChange = rollingAvg
          ? ((current.expense - rollingAvg) / rollingAvg) * 100
          : 0;

        let anomaly = "normal";
        if (
          Math.abs(percentChange) >= threshold &&
          Math.abs(current.expense - rollingAvg) >= minAmount
        ) {
          anomaly = percentChange > 0 ? "spike" : "drop";
        }

        results.push({
          ...current,
          rollingAvg: Number(rollingAvg.toFixed(2)),
          percentChange: Number(percentChange.toFixed(2)),
          anomaly,
          method,
        });
      }
    } else if (method === "zScore") {
      const expenses = filteredSummary.map((x) => x.expense);
      const mean = expenses.reduce((a, b) => a + b, 0) / expenses.length;
      const stdDev = Math.sqrt(
        expenses.map((x) => (x - mean) ** 2).reduce((a, b) => a + b, 0) /
          expenses.length
      );

      filteredSummary.forEach((item) => {
        const zScore = stdDev ? (item.expense - mean) / stdDev : 0;
        let anomaly = "normal";
        if (
          Math.abs(zScore) >= zThreshold &&
          Math.abs(item.expense - mean) >= minAmount
        ) {
          anomaly = zScore > 0 ? "spike" : "drop";
        }
        results.push({
          ...item,
          zScore: Number(zScore.toFixed(2)),
          anomaly,
          method,
        });
      });
    } else if (method === "previous") {
      results.push({ ...filteredSummary[0], anomaly: "normal", method });

      for (let i = 1; i < filteredSummary.length; i++) {
        const prev = filteredSummary[i - 1];
        const current = filteredSummary[i];
        const change = current.expense - prev.expense;
        const percentChange = prev.expense
          ? (change / prev.expense) * 100
          : 100;

        let anomaly = "normal";
        if (
          Math.abs(percentChange) >= threshold &&
          Math.abs(change) >= minAmount
        ) {
          anomaly = change > 0 ? "spike" : "drop";
        }

        results.push({
          ...current,
          percentChange: Number(percentChange.toFixed(2)),
          anomaly,
          method,
        });
      }
    }

    res.json({ success: true, anomalies: results });
  } catch (error) {
    res
      .status(errorStatus(error))
      .json({ error: "Something went wrong", details: publicError(error) });
  }
});

// One year against another. Totals and categories only cover finished
// months that both years have data for, so a year that started in May (or
// a half-done October) isn't "down 40%" against a full one.
const validYear = (y) => Number.isInteger(y) && y >= 1970 && y <= 2100;
const EXPENSE_CATEGORIES = ["need", "want", "investment", "other"];

insightRouter.get("/compare", userAuth, async (req, res) => {
  try {
    const year = Number(req.query.year);
    const against =
      req.query.against === undefined ? year - 1 : Number(req.query.against);
    if (!validYear(year) || !validYear(against) || year === against) {
      return res
        .status(400)
        .json({ message: "Pick two different, valid years" });
    }
    const userId = req.user._id;
    const [current, previous] = await Promise.all([
      monthlySummary(userId, { year }),
      monthlySummary(userId, { year: against }),
    ]);
    const now = new Date();
    // the current month isn't over yet: leave it out of the totals
    const lastMonth =
      Math.max(year, against) === now.getUTCFullYear() ? now.getUTCMonth() : 12;
    const has = (rows, m) => rows.some((r) => r.monthNumber === m);
    const period = Array.from({ length: lastMonth }, (_, i) => i + 1).filter(
      (m) => has(current, m) && has(previous, m)
    );

    const zero = { income: 0, expense: 0, savings: 0 };
    const pick = (rows, m) => {
      const r = rows.find((x) => x.monthNumber === m);
      return r
        ? { income: r.income, expense: r.expense, savings: r.savings }
        : zero;
    };
    const months = Array.from({ length: 12 }, (_, i) => ({
      monthNumber: i + 1,
      month: MonthList[i + 1],
      current: pick(current, i + 1),
      previous: pick(previous, i + 1),
    }));
    const sum = (key) =>
      months
        .filter((m) => period.includes(m.monthNumber))
        .reduce(
          (t, m) => ({
            income: t.income + m[key].income,
            expense: t.expense + m[key].expense,
            savings: t.savings + m[key].savings,
          }),
          zero
        );

    // Spending per category over the same months
    const byCategory = period.length
      ? await Transaction.aggregate([
          {
            $match: {
              userId,
              type: "expense",
              category: { $in: EXPENSE_CATEGORIES },
              date: {
                $gte: new Date(Date.UTC(Math.min(year, against), 0, 1)),
                $lt: new Date(Date.UTC(Math.max(year, against) + 1, 0, 1)),
              },
            },
          },
          {
            $project: {
              category: 1,
              amount: 1,
              y: { $year: "$date" },
              m: { $month: "$date" },
            },
          },
          { $match: { y: { $in: [year, against] }, m: { $in: period } } },
          {
            $group: {
              _id: { category: "$category", y: "$y" },
              total: { $sum: "$amount" },
            },
          },
        ])
      : [];
    const categoryTotal = (category, y) =>
      byCategory.find((c) => c._id.category === category && c._id.y === y)
        ?.total || 0;

    res.json({
      year,
      against,
      period,
      months,
      totals: { current: sum("current"), previous: sum("previous") },
      categories: EXPENSE_CATEGORIES.map((category) => ({
        category,
        current: categoryTotal(category, year),
        previous: categoryTotal(category, against),
      })),
    });
  } catch (error) {
    res.status(errorStatus(error)).json({ message: publicError(error) });
  }
});

// "At this pace you'll have ₹X left at month end" (current month)
insightRouter.get("/forecast", userAuth, async (req, res) => {
  try {
    res.json(await monthForecast(req.user._id));
  } catch (error) {
    res.status(errorStatus(error)).json({ message: publicError(error) });
  }
});

export default insightRouter;
