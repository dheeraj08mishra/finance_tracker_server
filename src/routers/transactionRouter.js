import express from "express";
import mongoose from "mongoose";
import { publicError, errorStatus } from "../utils/errors.js";
import Transaction from "../model/transactions.js";
import userAuth from "../middleware/auth.js";
import validator from "validator";
import RecurringTransaction from "../model/recurringTransaction.js";
import Goal from "../model/goal.js";
import ExcelJS from "exceljs";
import {
  toDayString,
  isFutureDay,
  earliestTodayString,
  latestTodayString,
  nextOccurrenceAfter,
  MONTH_NAMES,
} from "../utils/dates.js";

// Frequencies users may pick ("minutely" exists only for testing)
const USER_FREQUENCIES = ["daily", "weekly", "monthly", "yearly"];
const MAX_AMOUNT = 10000000;

// Positive number with at most 2 decimals, or null
const parseAmount = (amount) => {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0 || n > MAX_AMOUNT) return null;
  return Math.round(n * 100) / 100;
};

// Error message for a transaction date, or null if it is allowed.
// Product rule: only days in the current month (lenient across timezones).
const validateTransactionDay = (date) => {
  if (typeof date !== "string" || !validator.isISO8601(date)) {
    return "Invalid date format. Use YYYY-MM-DD.";
  }
  if (isFutureDay(date)) return "Date cannot be in the future";
  if (toDayString(date).slice(0, 7) < earliestTodayString().slice(0, 7)) {
    return "Date must be within the current month.";
  }
  return null;
};

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

    note = typeof note === "string" ? note.trim() : "";

    if (!type || amount === undefined || !category || !date) {
      return res.status(400).json({
        success: false,
        message: "Please provide data in all required fields",
      });
    }
    const dateError = validateTransactionDay(date);
    if (dateError) {
      return res.status(400).json({ success: false, message: dateError });
    }
    const amountNum = parseAmount(amount);
    if (amountNum === null) {
      return res.status(400).json({
        success: false,
        message: `Amount must be a positive number up to ${MAX_AMOUNT}`,
      });
    }

    if (isRecurring && !USER_FREQUENCIES.includes(frequency)) {
      return res.status(400).json({
        success: false,
        message: `Frequency must be one of: ${USER_FREQUENCIES.join(", ")}`,
      });
    }
    if (!isRecurring && frequency) {
      return res.status(400).json({
        success: false,
        message:
          "Frequency should not be provided for non-recurring transactions",
      });
    }
    if (
      endDate &&
      (!validator.isISO8601(String(endDate)) ||
        toDayString(endDate) < toDayString(date))
    ) {
      return res.status(400).json({
        success: false,
        message: "End date must be a valid date on or after the start date",
      });
    }

    const inputDate = toDayString(date); // stored as UTC midnight of that day
    const newTransaction = new Transaction({
      userId: user._id,
      type,
      amount: amountNum,
      note,
      category,
      date: inputDate,
      isRecurring: Boolean(isRecurring),
      frequency: isRecurring ? frequency : "",
    });

    let newRecurringTransaction = null;
    if (isRecurring) {
      newRecurringTransaction = new RecurringTransaction({
        userId: user._id,
        type,
        amount: amountNum,
        note,
        category,
        frequency,
        startDate: inputDate,
        nextOccurrence: nextOccurrenceAfter(frequency, inputDate, inputDate),
        isActive: true,
        lastOccurrence: null,
        parentTransactionId: newTransaction._id,
        createdBy: user._id,
        updatedBy: user._id,
        ...(endDate && { endDate: toDayString(endDate) }),
      });
      // Link the first transaction to its rule so it is never re-created
      newTransaction.recurringTransactionId = newRecurringTransaction._id;
      await newRecurringTransaction.validate();
    }
    await newTransaction.save();
    if (newRecurringTransaction) await newRecurringTransaction.save();

    res.status(201).json({
      success: true,
      message: "Transaction added successfully",
      data: newTransaction,
      recurring: newRecurringTransaction,
    });
  } catch (error) {
    const message = publicError(error);
    res.status(errorStatus(error)).json({
      success: false,
      message,
      error: message,
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
    // No limit = everything (History page relies on this until it paginates)
    const page = req.query.page === undefined ? 1 : Number(req.query.page);
    const limit =
      req.query.limit === undefined
        ? totalTransactions
        : Number(req.query.limit);
    if (
      !Number.isInteger(page) ||
      page < 1 ||
      !Number.isInteger(limit) ||
      limit < 1
    ) {
      return res.status(400).json({
        success: false,
        message: "page and limit must be positive integers",
      });
    }
    const skip = (page - 1) * limit;
    const totalPages = Math.ceil(totalTransactions / limit);

    // A page past the end is just empty, not an error
    const [transactions, totals] = await Promise.all([
      Transaction.find({ userId: user._id })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Transaction.aggregate([
        { $match: { userId: user._id, type: { $in: ["income", "expense"] } } },
        { $group: { _id: "$type", total: { $sum: "$amount" } } },
      ]),
    ]);
    const totalOf = (type) => totals.find((t) => t._id === type)?.total || 0;
    const totalExpenseAmount = totalOf("expense");
    const totalIncomeAmount = totalOf("income");
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
    res.status(errorStatus(error)).json({
      success: false,
      message: "Something went wrong",
      error: publicError(error),
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
        !validator.isInt(year, {
          min: 2000,
          max: Number(latestTodayString().slice(0, 4)),
        })
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
      res.status(errorStatus(error)).json({
        success: false,
        message: "Something went wrong",
        error: publicError(error),
      });
    }
  }
);

transactionRouter.get(
  "/user/transaction/dataMonthList",
  userAuth,
  async (req, res) => {
    try {
      const months = await Transaction.aggregate([
        { $match: { userId: req.user._id } },
        {
          $group: {
            _id: { year: { $year: "$date" }, month: { $month: "$date" } },
          },
        },
        { $sort: { "_id.year": -1, "_id.month": -1 } },
      ]);
      // English names: the frontend maps them back to month numbers
      const monthList = months.map(({ _id }) => ({
        month: MONTH_NAMES[_id.month - 1],
        year: _id.year,
      }));

      return res.status(200).json({
        success: true,
        message: "Transaction data month list retrieved successfully",
        data: monthList,
      });
    } catch (error) {
      res.status(errorStatus(error)).json({
        success: false,
        message: "Something went wrong",
        error: publicError(error),
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
      note = typeof note === "string" ? note.trim() : "";
      if (!type || amount === undefined || !category || !date) {
        return res.status(400).json({
          success: false,
          message: "Please provide type, amount, category and date",
        });
      }
      const dateError = validateTransactionDay(date);
      if (dateError) {
        return res.status(400).json({ success: false, message: dateError });
      }
      const amountNum = parseAmount(amount);
      if (amountNum === null) {
        return res.status(400).json({
          success: false,
          message: `Amount must be a positive number up to ${MAX_AMOUNT}`,
        });
      }

      // Commits on success, rolls back and ends the session on any error
      const transaction = await mongoose.connection.transaction(
        async (session) => {
          const txn = await Transaction.findOne({
            _id: id,
            userId: user._id,
          }).session(session);
          if (!txn) return null;

          if (txn.isGoalTransaction && txn.goalId) {
            // A goal contribution stays a goal expense; only amount/note/date change
            type = "expense";
            category = "goal";
            const goal = await Goal.findOne({
              _id: txn.goalId,
              userId: user._id,
            }).session(session);
            if (goal) {
              goal.currentAmount = Math.max(
                0,
                goal.currentAmount + amountNum - txn.amount
              );
              goal.checkGoalStatus();
              await goal.save({ session });
            }
          }

          txn.type = type;
          txn.amount = amountNum;
          txn.note = note;
          txn.category = category;
          txn.date = toDayString(date);
          await txn.save({ session });

          // Editing the first transaction of a series updates the series too
          await RecurringTransaction.updateOne(
            { parentTransactionId: txn._id, userId: user._id, isActive: true },
            { type, amount: amountNum, note, category, updatedBy: user._id },
            { session, runValidators: true }
          );
          return txn;
        }
      );

      if (!transaction) {
        return res
          .status(404)
          .json({ success: false, message: "Transaction not found" });
      }
      res.status(200).json({
        success: true,
        message: "Transaction updated successfully",
        data: transaction,
      });
    } catch (error) {
      const message = publicError(error);
      res
        .status(errorStatus(error))
        .json({ success: false, message, error: message });
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

      const transaction = await mongoose.connection.transaction(
        async (session) => {
          const txn = await Transaction.findOne({
            _id: id,
            userId: user._id,
          }).session(session);
          if (!txn) return null;

          if (txn.isGoalTransaction && txn.goalId) {
            const goal = await Goal.findOne({
              _id: txn.goalId,
              userId: user._id,
            }).session(session);
            if (goal) {
              goal.currentAmount = Math.max(0, goal.currentAmount - txn.amount);
              goal.checkGoalStatus();
              await goal.save({ session });
            }
          }

          // Deleting the first transaction of a series stops the series
          // (it already disappeared from the Recurring page but kept running)
          await RecurringTransaction.updateOne(
            { parentTransactionId: txn._id, userId: user._id },
            { isActive: false, nextOccurrence: null, updatedBy: user._id },
            { session }
          );

          await Transaction.deleteOne({ _id: txn._id }).session(session);
          return txn;
        }
      );

      if (!transaction) {
        return res
          .status(404)
          .json({ success: false, message: "Transaction not found" });
      }
      res.status(200).json({
        success: true,
        message: "Transaction deleted successfully",
        data: { transactionId: transaction._id },
      });
    } catch (error) {
      const message = publicError(error);
      res
        .status(errorStatus(error))
        .json({ success: false, message, error: message });
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

      const workBook = new ExcelJS.Workbook();
      const workSheet = workBook.addWorksheet("Transactions");
      workSheet.columns = Object.keys(exceldata[0]).map((key) => ({
        header: key,
        key,
        width: key === "Note" ? 40 : 14,
      }));
      workSheet.addRows(exceldata); // plain values: notes never become formulas
      workSheet.getRow(1).font = { bold: true };

      const excelBuffer = Buffer.from(await workBook.xlsx.writeBuffer());
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
      res.status(errorStatus(error)).json({
        success: false,
        message: "Something went wrong",
        error: publicError(error),
      });
    }
  }
);

transactionRouter.get(
  "/user/transactions/:txnId",
  userAuth,
  async (req, res) => {
    try {
      const user = req.user;
      const { txnId } = req.params;

      if (!txnId) {
        return res.status(400).json({
          success: false,
          message: "Transaction ID is required",
        });
      }

      const transaction = await Transaction.findOne({
        _id: txnId,
        userId: user._id,
      });

      if (!transaction) {
        return res.status(404).json({
          success: false,
          message: "Transaction not found",
        });
      }

      res.status(200).json({
        success: true,
        message: "Transaction retrieved successfully",
        data: transaction,
      });
    } catch (error) {
      res.status(errorStatus(error)).json({
        success: false,
        message: "Something went wrong",
        error: publicError(error),
      });
    }
  }
);

export default transactionRouter;
