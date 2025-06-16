import express from "express";
import Transaction from "../model/transactions.js";
import userAuth from "../middleware/auth.js";
import validator from "validator";
import RecurringTransaction from "../model/recurringTransaction.js";
import {
  addMinutes,
  addDays,
  addWeeks,
  addMonths,
  addYears,
  isBefore,
  startOfMonth,
  isAfter,
  format,
  parseISO,
} from "date-fns";

import XLSX from "xlsx";

function getNextOccurrence(frequency, baseDate) {
  switch (frequency) {
    case "minutely":
      return addMinutes(baseDate, 1);
    case "daily":
      return addDays(baseDate, 1);
    case "weekly":
      return addWeeks(baseDate, 1);
    case "monthly":
      return addMonths(baseDate, 1);
    case "yearly":
      return addYears(baseDate, 1);
    default:
      return null;
  }
}

const transactionRouter = express.Router();

// Add a transaction
transactionRouter.post("/user/addTransaction", userAuth, async (req, res) => {
  try {
    const user = req.user;
    let {
      type,
      amount,
      note,
      category,
      date,
      isRecurring,
      frequency,
      endDate,
    } = req.body;

    note = note.trim() || "";

    if (!validator.isISO8601(date)) {
      return res
        .status(400)
        .json({ message: "Invalid date format. Use YYYY-MM-DD." });
    }
    const getUTCDate = (dateStr) => {
      return new Date(dateStr).toISOString().slice(0, 10);
    };

    const inputDate = getUTCDate(date);

    if (isBefore(parseISO(date), startOfMonth(new Date()))) {
      toast.error("Date must be within the current month.");
      return;
    }
    if (isAfter(parseISO(date), new Date())) {
      return res.status(400).json({
        success: false,
        message: "Date cannot be in the future",
      });
    }

    if (!type || !amount || !category || !date) {
      return res.status(400).json({
        success: false,
        message: "Please provide data in all required fields",
      });
    }

    if (isRecurring && !frequency) {
      return res.status(400).json({
        success: false,
        message: "Frequency is required for recurring transactions",
      });
    }
    if (!isRecurring && frequency) {
      return res.status(400).json({
        success: false,
        message:
          "Frequency should not be provided for non-recurring transactions",
      });
    }

    //  Always save the transaction
    const newTransaction = new Transaction({
      userId: user._id,
      type,
      amount: Number(parseFloat(amount).toFixed(2)),
      note,
      category,
      date: inputDate,
      isRecurring: isRecurring || false,
      frequency: isRecurring ? frequency : "",
    });
    await newTransaction.save();

    //  If recurring, also save in RecurringTransaction
    let newRecurringTransaction = null;
    if (isRecurring) {
      const nextOccurrence = getNextOccurrence(frequency, inputDate);

      newRecurringTransaction = new RecurringTransaction({
        userId: user._id,
        type,
        amount: Number(parseFloat(amount).toFixed(2)),
        note,
        category,
        frequency,
        startDate: inputDate,
        nextOccurrence,
        isActive: true,
        lastOccurrence: null,
        parentTransactionId: newTransaction._id,
        createdBy: user._id,
        updatedBy: user._id,
        ...(endDate && { endDate: getUTCDate(endDate) }),
      });
      await newRecurringTransaction.save();
    }

    res.status(201).json({
      success: true,
      message: "Transaction added successfully",
      data: newTransaction,
      recurring: newRecurringTransaction,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to add transaction",
      error: error.message,
    });
  }
});

// Get all transactions with pagination
transactionRouter.get("/user/transactions", userAuth, async (req, res) => {
  try {
    const user = req.user;
    const totalTransactions = await Transaction.countDocuments({
      userId: user._id,
    });
    if (totalTransactions === 0) {
      return res.status(200).json({
        success: true,
        message: "No transactions found",
        data: {
          transactions: [],
          totalExpenseAmount: 0,
          totalIncomeAmount: 0,
          balance: 0,
          pagination: {
            currentPage: 1,
            totalPages: 1,
            totalTransactions: 0,
          },
        },
      });
    }
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || totalTransactions;

    if (isNaN(limit) || limit < 1) {
      return res.status(400).json({
        success: false,
        message: "Invalid limit parameters",
      });
    }

    if (
      isNaN(page) ||
      page < 1 ||
      page > Math.ceil(totalTransactions / limit)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid page parameters",
      });
    }
    const skip = (page - 1) * limit;
    const totalPages = Math.ceil(totalTransactions / limit);

    const transactions = await Transaction.find({ userId: user._id })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    // total expense and income
    const totalExpense = await Transaction.aggregate([
      { $match: { userId: user._id, type: "expense" } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);
    const totalIncome = await Transaction.aggregate([
      { $match: { userId: user._id, type: "income" } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);
    const totalExpenseAmount = totalExpense.length ? totalExpense[0].total : 0;
    const totalIncomeAmount = totalIncome.length ? totalIncome[0].total : 0;
    const balance = totalIncomeAmount - totalExpenseAmount;

    /// recurring transactions
    const recurringTransactions = await RecurringTransaction.find({
      userId: user._id,
      isActive: true,
    });

    res.status(200).json({
      success: true,
      message: "Transactions retrieved successfully",
      data: {
        transactions,
        totalExpenseAmount,
        totalIncomeAmount,
        recurringTransactions,
        balance,
        pagination: {
          currentPage: page,
          totalPages,
          totalTransactions,
        },
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Something went wrong",
      error: error.message,
    });
  }
});

transactionRouter.get(
  "/user/transactions/monthly",
  userAuth,
  async (req, res) => {
    try {
      const user = req.user;
      let { month, year } = req.query;
      if (!month || !year) {
        return res.status(400).json({
          success: false,
          message: "Please provide month and year",
        });
      }
      if (!validator.isInt(month, { min: 1, max: 12 })) {
        return res.status(400).json({
          success: false,
          message: "Month must be an integer between 1 and 12",
        });
      }
      if (
        !validator.isInt(year, { min: 2000, max: new Date().getFullYear() })
      ) {
        return res.status(400).json({
          success: false,
          message: "Year must be a valid integer and not in the future",
        });
      }
      month = Number(month) - 1;
      year = Number(year);

      const startOfMonth = new Date(year, month, 1);
      const endOfMonth = new Date(year, month + 1, 0, 23, 59, 59, 999);

      const transactions = await Transaction.find({
        userId: user._id,
        date: {
          $gte: startOfMonth,
          $lte: endOfMonth,
        },
      }).sort({ date: -1 });

      return res.status(200).json({
        success: true,
        message: "Monthly transactions retrieved successfully",
        data: {
          transactions,
        },
        totalTransactions: transactions.length,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Something went wrong",
        error: error.message,
      });
    }
  }
);

transactionRouter.get(
  "/user/transaction/dataMonthList",
  userAuth,
  async (req, res) => {
    try {
      const user = req.user;
      const Transactions = await Transaction.find({ userId: user._id })
        .sort({
          date: -1,
        })
        .select({ date: 1 })
        .distinct("date");

      const monthList = Transactions.map((date) => {
        const data = new Date(date);
        return {
          month: data.toLocaleString("default", { month: "long" }),
          year: data.getFullYear(),
        };
      }).filter(
        (value, index, self) =>
          index ===
          self.findIndex(
            (t) => t.month === value.month && t.year === value.year
          )
      );

      return res.status(200).json({
        success: true,
        message: "Transaction data month list retrieved successfully",
        data: monthList,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Something went wrong",
        error: error.message,
      });
    }
  }
);

// Update a transaction
transactionRouter.patch(
  "/user/update/transaction/:id",
  userAuth,
  async (req, res) => {
    try {
      const user = req.user;
      const { id } = req.params;
      let { type, amount, note, category, date } = req.body;
      note = note.trim() || "";

      if (!validator.isISO8601(date)) {
        return res
          .status(400)
          .json({ message: "Invalid date format. Use YYYY-MM-DD." });
      }

      const inputDate = new Date(date);
      if (isBefore(inputDate, startOfMonth(new Date()))) {
        return res.status(400).json({
          success: false,
          message: "Date must be within the current month.",
        });
      }
      if (isAfter(inputDate, new Date())) {
        return res.status(400).json({
          success: false,
          message: "Date cannot be in the future",
        });
      }

      if (!type || !amount || !category || !date) {
        return res.status(400).json({
          success: false,
          message: "Please provide data in all fields",
        });
      }
      if (isNaN(amount) || parseFloat(amount) <= 0) {
        return res.status(400).json({
          success: false,
          message: "Amount must be a positive number",
        });
      }

      amount = parseFloat(amount).toFixed(2);

      const transaction = await Transaction.findOneAndUpdate(
        { _id: id, userId: user._id },
        { type, amount, note, category, date },
        { new: true }
      );

      if (!transaction) {
        return res.status(404).json({
          success: false,
          message: "Transaction not found",
        });
      }
      await transaction.save();

      res.status(200).json({
        success: true,
        message: "Transaction updated successfully",
        data: transaction,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Something went wrong",
        error: error.message,
      });
    }
  }
);

// Delete a transaction
transactionRouter.delete(
  "/user/transaction/delete/:id",
  userAuth,
  async (req, res) => {
    try {
      const user = req.user;
      const { id } = req.params;

      const transaction = await Transaction.findOneAndDelete({
        _id: id,
        userId: user._id,
      });

      if (!transaction) {
        return res.status(404).json({
          success: false,
          message: "Transaction not found",
        });
      }

      // If the transaction is recurring, delete the associated recurring transaction
      // if (transaction.isRecurring) {
      //   await RecurringTransaction.deleteOne({
      //     parentTransactionId: transaction._id,
      //   });
      // }

      res.status(200).json({
        success: true,
        message: "Transaction deleted successfully",
        data: { transactionId: transaction._id },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Something went wrong",
        error: error.message,
      });
    }
  }
);

/// add isRecurring and frequency to the transaction schema for old transactions
transactionRouter.patch(
  "/user/transactions/update/recurring",
  userAuth,
  async (req, res) => {
    try {
      const user = req.user;
      const transactionsList = await Transaction.find({ userId: user._id });
      if (!transactionsList || transactionsList.length === 0) {
        return res.status(404).json({
          success: false,
          message: "No transactions found for the user",
        });
      }
      console.log("transactionsList", transactionsList);
      transactionsList.forEach(async (transaction) => {
        if (transaction.isRecurring === undefined) {
          transaction.isRecurring = false;
          transaction.frequency = "";
        }
        await transaction.save();
      });

      res.status(200).json({
        success: true,
        message: "Transactions retrieved successfully",
        data: transactionsList,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Something went wrong",
        error: error.message,
      });
    }
  }
);

/// export all transactions for a user
transactionRouter.get(
  "/user/transactions/export/excel",
  userAuth,
  async (req, res) => {
    try {
      const user = req.user;
      let { month, year } = req.query;

      if (month && !validator.isInt(month, { min: 1, max: 12 })) {
        return res.status(400).json({
          success: false,
          message: "Month must be an integer between 1 and 12",
        });
      }
      if (year && !validator.isInt(year)) {
        return res.status(400).json({
          success: false,
          message: "Year must be a valid integer",
        });
      }

      month = month ? Number(month) - 1 : null;
      year = year ? Number(year) : null;

      const startOfMonth =
        month !== null && year !== null ? new Date(year, month, 1) : null;
      const endOfMonth =
        month !== null && year !== null
          ? new Date(year, month + 1, 0, 23, 59, 59, 999)
          : null;

      const transactions = await Transaction.find({
        userId: user._id,
        ...(startOfMonth && endOfMonth
          ? { date: { $gte: startOfMonth, $lte: endOfMonth } }
          : {}),
      }).sort({ date: -1 });

      if (!transactions || transactions.length === 0) {
        return res.status(404).json({
          success: false,
          message: "No transactions found for the user",
        });
      }

      const exceldata = transactions.map((transaction) => {
        return {
          Type: transaction.type,
          Amount: transaction.amount,
          Note: transaction.note,
          Category: transaction.category,
          Date: transaction.date.toISOString().split("T")[0], // Format date as YYYY-MM-DD
          IsRecurring: transaction.isRecurring ? "Yes" : "No",
          Frequency: transaction.frequency || "N/A",
        };
      });

      const workSheet = XLSX.utils.json_to_sheet(exceldata);
      const workBook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workBook, workSheet, "Transactions");

      const excelBuffer = XLSX.write(workBook, {
        bookType: "xlsx",
        type: "buffer",
      });
      const filename =
        "transactions" +
        (month !== null && year !== null
          ? `_${year}-${String(month + 1).padStart(2, "0")}`
          : "") +
        ".xlsx";
      res.setHeader("Content-Disposition", `attachment; filename=${filename}`);
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      res.setHeader("Content-Length", excelBuffer.length);
      res.send(excelBuffer);
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Something went wrong",
        error: error.message,
      });
    }
  }
);

export default transactionRouter;
