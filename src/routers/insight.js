import express from "express";
import Transaction from "../model/transactions.js";
import userAuth from "../middleware/auth.js";

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

insightRouter.get("/monthlySummary", userAuth, async (req, res) => {
  try {
    const userId = req.user._id;

    const transactions = await Transaction.aggregate([
      { $match: { userId } },
      {
        $group: {
          _id: {
            year: { $year: "$date" },
            month: { $month: "$date" },
            type: "$type",
          },
          totalAmount: { $sum: "$amount" },
        },
      },
      {
        $group: {
          _id: {
            year: "$_id.year",
            month: "$_id.month",
          },
          totals: {
            $push: {
              type: "$_id.type",
              amount: "$totalAmount",
            },
          },
        },
      },
      { $sort: { "_id.year": -1, "_id.month": -1 } },
    ]);

    const summary = transactions.map((item) => {
      const incomeObj = item.totals.find((t) => t.type === "income");
      const expenseObj = item.totals.find((t) => t.type === "expense");
      return {
        year: item._id.year,
        month: MonthList[item._id.month],
        monthNumber: item._id.month,
        income: incomeObj ? incomeObj.amount : 0,
        expense: expenseObj ? expenseObj.amount : 0,
      };
    });
    res.json({ success: true, summary });
  } catch (error) {
    res
      .status(500)
      .json({ error: "Something went wrong", details: error.message });
  }
});

// filter on year

insightRouter.post("/monthlySummary", userAuth, async (req, res) => {
  try {
    const userId = req.user._id;
    const { year } = req.body;

    if (!year || isNaN(year) || year < 1970 || year > 2100) {
      return res.status(400).json({ error: "Invalid year provided" });
    }

    const transactions = await Transaction.aggregate([
      { $match: { userId } },
      {
        $group: {
          _id: {
            year: { $year: "$date" },
            month: { $month: "$date" },
            type: "$type",
          },
          totalAmount: { $sum: "$amount" },
        },
      },
      {
        $group: {
          _id: {
            year: "$_id.year",
            month: "$_id.month",
          },
          totals: {
            $push: {
              type: "$_id.type",
              amount: "$totalAmount",
            },
          },
        },
      },
      { $sort: { "_id.year": -1, "_id.month": 1 } },
    ]);

    const summary = transactions.map((item) => {
      const incomeObj = item.totals.find((t) => t.type === "income");
      const expenseObj = item.totals.find((t) => t.type === "expense");
      return {
        year: item._id.year,
        month: MonthList[item._id.month],
        monthNumber: item._id.month,
        income: incomeObj ? incomeObj.amount : 0,
        expense: expenseObj ? expenseObj.amount : 0,
      };
    });

    const filteredSummary = summary.filter(
      (item) => item.year === Number(year)
    );

    res.json({ success: true, summary: filteredSummary });
  } catch (error) {
    res
      .status(500)
      .json({ error: "Something went wrong", details: error.message });
  }
});

insightRouter.post("/anomalyDetection", userAuth, async (req, res) => {
  try {
    const userId = req.user._id;
    let { thresholdPercent, year, method, zThreshold, minAmount } = req.body;

    // Thresholds
    const threshold = !isNaN(thresholdPercent) ? Number(thresholdPercent) : 5;
    if (threshold < 0 || threshold > 100) {
      return res
        .status(400)
        .json({ error: "Threshold percent must be between 0 and 100" });
    }

    zThreshold = !isNaN(zThreshold) ? Number(zThreshold) : 1;
    if (zThreshold <= 0) {
      return res
        .status(400)
        .json({ error: "Z-Score threshold must be positive" });
    }

    minAmount = !isNaN(minAmount) ? Number(minAmount) : 500;
    const transactions = await Transaction.aggregate([
      { $match: { userId } },
      {
        $group: {
          _id: {
            year: { $year: "$date" },
            month: { $month: "$date" },
            type: "$type",
          },
          totalAmount: { $sum: "$amount" },
        },
      },
      {
        $group: {
          _id: { year: "$_id.year", month: "$_id.month" },
          totals: { $push: { type: "$_id.type", amount: "$totalAmount" } },
        },
      },
      { $sort: { "_id.year": 1, "_id.month": 1 } },
    ]);

    // Build summary
    const summary = transactions.map((item) => {
      const incomeObj = item.totals.find((t) => t.type === "income");
      const expenseObj = item.totals.find((t) => t.type === "expense");
      return {
        year: item._id.year,
        month: MonthList[item._id.month],
        monthNumber: item._id.month,
        income: incomeObj ? incomeObj.amount : 0,
        expense: expenseObj ? expenseObj.amount : 0,
      };
    });

    // If year not provided → use all data
    const filteredSummary = year
      ? summary.filter((item) => item.year === Number(year))
      : summary;

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
      .status(500)
      .json({ error: "Something went wrong", details: error.message });
  }
});

export default insightRouter;
