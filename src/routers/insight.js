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

export default insightRouter;
