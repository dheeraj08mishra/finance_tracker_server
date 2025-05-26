import express from "express";
import Transaction from "../model/transactions.js";
import userAuth from "../middleware/auth.js";
import validator from "validator";

const transactionRouter = express.Router();

// Add a transaction
transactionRouter.post("/user/addTransaction", userAuth, async (req, res) => {
  try {
    const user = req.user;
    const { type, amount, note, category, date } = req.body;
    if (!validator.isISO8601(date)) {
      return res
        .status(400)
        .json({ message: "Invalid date format. Use YYYY-MM-DD." });
    }

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    if (new Date(date) < startOfMonth || new Date(date) > now) {
      return res.status(400).json({
        message: "Date must be between start of this month and today.",
      });
    }

    if (!type || !amount || !category || !date) {
      return res.status(400).json({
        success: false,
        message: "Please provide data in all required fields",
      });
    }

    const newTransaction = new Transaction({
      userId: user._id,
      type,
      amount: parseFloat(amount).toFixed(2),
      note,
      category,
      date,
    });

    await newTransaction.save();

    res.status(201).json({
      success: true,
      message: "Transaction added successfully",
      data: newTransaction,
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
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || totalTransactions;

    if (page < 1 || limit < 1) {
      return res.status(400).json({
        success: false,
        message: "Page and limit must be greater than 0",
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

    res.status(200).json({
      success: true,
      message: "Transactions retrieved successfully",
      data: {
        transactions,
        totalExpenseAmount,
        totalIncomeAmount,
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

// Update a transaction
transactionRouter.patch(
  "/user/update/transaction/:id",
  userAuth,
  async (req, res) => {
    try {
      const user = req.user;
      const { id } = req.params;
      let { type, amount, note, category, date } = req.body;

      if (!validator.isISO8601(date)) {
        return res
          .status(400)
          .json({ message: "Invalid date format. Use YYYY-MM-DD." });
      }

      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

      if (new Date(date) < startOfMonth || new Date(date) > now) {
        return res.status(400).json({
          message: "Date must be between start of this month and today.",
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
      if (new Date(date) > new Date()) {
        return res.status(400).json({
          success: false,
          message: "Date cannot be in the future",
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

export default transactionRouter;
