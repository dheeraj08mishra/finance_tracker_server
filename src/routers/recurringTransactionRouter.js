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

recurringTransactionRouter.get("/transactions", userAuth, async (req, res) => {
  try {
    const userId = req.user._id;
    const recurringTransactions = await RecurringTransaction.find({ userId });
    res.json({
      message: "Recurring transactions retrieved successfully",
      data: recurringTransactions,
    });
  } catch (error) {
    res.status(400).send({ error: error.message });
  }
});

export default recurringTransactionRouter;
