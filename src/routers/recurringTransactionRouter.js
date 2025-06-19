import express from "express";
import RecurringTransaction from "../model/recurringTransaction.js";
import userAuth from "../middleware/auth.js";
import { addDays, addWeeks, addMonths, addYears } from "date-fns";

const recurringTransactionRouter = express.Router();

function getNextOccurrence(frequency, baseDate) {
  switch (frequency) {
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

recurringTransactionRouter.post(
  "/addTransaction",
  userAuth,
  async (req, res) => {
    try {
      const userId = req.user._id;
      const { type, amount, category, note, frequency, startDate, endDate } =
        req.body;
      const baseDate = new Date(startDate);
      const nextOccurrence = getNextOccurrence(frequency, baseDate);

      const newRecurringTransaction = new RecurringTransaction({
        userId,
        type,
        amount,
        category,
        note,
        frequency,
        startDate: baseDate,
        nextOccurrence,
        isActive: true,
        createdBy: userId,
        updatedBy: userId,
        ...(endDate && { endDate: new Date(endDate) }),
      });

      await newRecurringTransaction.save();

      res.status(201).send({
        message: "Recurring transaction created successfully",
        data: newRecurringTransaction,
      });
    } catch (error) {
      res.status(400).send({ error: error.message });
    }
  }
);
// pause a recurring transaction

recurringTransactionRouter.post(
  "/pauseTransaction/:id",
  userAuth,
  async (req, res) => {
    try {
      const userId = req.user._id;
      const { id } = req.params;
      const recurringTransaction = await RecurringTransaction.findOneAndUpdate(
        { _id: id, userId },
        { isActive: false, updatedBy: userId, nextOccurrence: null },
        { new: true }
      );
      if (!recurringTransaction) {
        return res
          .status(404)
          .send({ error: "Recurring transaction not found" });
      }
      res.send({
        message: "Recurring transaction paused successfully",
        data: recurringTransaction,
      });
    } catch (error) {
      res.status(400).send({ error: error.message });
    }
  }
);

recurringTransactionRouter.post(
  "/resumeTransaction/:id",
  userAuth,
  async (req, res) => {
    try {
      const userId = req.user._id;
      const { id } = req.params;
      const recurringTransaction = await RecurringTransaction.findOneAndUpdate(
        { _id: id, userId },
        { isActive: true, updatedBy: userId },
        { new: true }
      );
      if (!recurringTransaction) {
        return res
          .status(404)
          .send({ error: "Recurring transaction not found" });
      }
      const baseDate = new Date(
        recurringTransaction.nextOccurrence !== null
          ? recurringTransaction.startDate
          : recurringTransaction.lastOccurrence
      );
      const nextOccurrence = getNextOccurrence(
        recurringTransaction.frequency,
        baseDate
      );
      recurringTransaction.nextOccurrence = nextOccurrence;
      await recurringTransaction.save();
      res.send({
        message: "Recurring transaction resumed successfully",
        data: recurringTransaction,
      });
    } catch (error) {
      res.status(400).send({ error: error.message });
    }
  }
);

recurringTransactionRouter.get("/transactions", userAuth, async (req, res) => {
  try {
    const userId = req.user._id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    const recurringTransactions = await RecurringTransaction.find({ userId })
      .skip(skip)
      .limit(limit)
      .sort({ createdAt: -1 });
    const totalCount = await RecurringTransaction.countDocuments({ userId });
    const totalPages = Math.ceil(totalCount / limit);
    const hasNextPage = page < totalPages;
    const hasPreviousPage = page > 1;
    const nextPage = hasNextPage ? page + 1 : null;
    const previousPage = hasPreviousPage ? page - 1 : null;
    const pagination = {
      totalCount,
      totalPages,
      hasNextPage,
      hasPreviousPage,
      nextPage,
      previousPage,
    };
    res.json({
      message: "Recurring transactions retrieved successfully",
      data: recurringTransactions,
      pagination,
    });
  } catch (error) {
    res.status(400).send({ error: error.message });
  }
});

export default recurringTransactionRouter;
