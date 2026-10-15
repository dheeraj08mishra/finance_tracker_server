import express from "express";
import validator from "validator";
import { publicError, errorStatus } from "../utils/errors.js";
import RecurringTransaction from "../model/recurringTransaction.js";
import userAuth from "../middleware/auth.js";
import { toDayString, nextOccurrenceAfter } from "../utils/dates.js";

const recurringTransactionRouter = express.Router();

const USER_FREQUENCIES = ["daily", "weekly", "monthly", "yearly"];

recurringTransactionRouter.post(
  "/addTransaction",
  userAuth,
  async (req, res) => {
    try {
      const userId = req.user._id;
      const { type, amount, category, note, frequency, startDate, endDate } =
        req.body;
      if (!USER_FREQUENCIES.includes(frequency)) {
        return res.status(400).send({
          error: `Frequency must be one of: ${USER_FREQUENCIES.join(", ")}`,
        });
      }
      if (!startDate || !validator.isISO8601(String(startDate))) {
        return res.status(400).send({ error: "Invalid start date" });
      }
      if (endDate && !validator.isISO8601(String(endDate))) {
        return res.status(400).send({ error: "Invalid end date" });
      }
      const start = toDayString(startDate);
      // Start counting from today so an old start date doesn't back-fill
      // years of transactions
      const after = start > toDayString(new Date()) ? start : new Date();

      const newRecurringTransaction = new RecurringTransaction({
        userId,
        type,
        amount,
        category,
        note,
        frequency,
        startDate: start,
        nextOccurrence: nextOccurrenceAfter(frequency, start, after),
        isActive: true,
        createdBy: userId,
        updatedBy: userId,
        ...(endDate && { endDate: toDayString(endDate) }),
      });

      await newRecurringTransaction.save();

      res.status(201).send({
        message: "Recurring transaction created successfully",
        data: newRecurringTransaction,
      });
    } catch (error) {
      res.status(errorStatus(error)).send({ error: publicError(error) });
    }
  }
);

recurringTransactionRouter.post(
  "/pauseTransaction/:id",
  userAuth,
  async (req, res) => {
    try {
      const userId = req.user._id;
      const recurringTransaction = await RecurringTransaction.findOne({
        _id: req.params.id,
        userId,
      });
      if (!recurringTransaction) {
        return res
          .status(404)
          .send({ error: "Recurring transaction not found" });
      }
      if (!recurringTransaction.isActive) {
        return res
          .status(400)
          .send({ error: "Transaction is already paused." });
      }
      recurringTransaction.isActive = false;
      recurringTransaction.updatedBy = userId;
      recurringTransaction.nextOccurrence = null;
      await recurringTransaction.save();
      res.send({
        message: "Recurring transaction paused successfully",
        data: recurringTransaction,
      });
    } catch (error) {
      res.status(errorStatus(error)).send({ error: publicError(error) });
    }
  }
);

recurringTransactionRouter.post(
  "/resumeTransaction/:id",
  userAuth,
  async (req, res) => {
    try {
      const userId = req.user._id;
      const rule = await RecurringTransaction.findOne({
        _id: req.params.id,
        userId,
      });
      if (!rule) {
        return res
          .status(404)
          .send({ error: "Recurring transaction not found" });
      }
      if (rule.isActive) {
        return res
          .status(400)
          .send({ error: "Transaction is already active." });
      }

      // Continue from the next date after today: payments that fell inside
      // the pause are skipped, not back-filled
      const now = new Date();
      const after =
        rule.lastOccurrence && rule.lastOccurrence > now
          ? rule.lastOccurrence
          : now;
      const nextOccurrence = nextOccurrenceAfter(
        rule.frequency,
        rule.startDate,
        after
      );
      if (rule.endDate && nextOccurrence > rule.endDate) {
        return res
          .status(400)
          .send({ error: "This recurring transaction has already ended." });
      }
      // Mark the skipped period as handled so the next run doesn't fill it in
      rule.lastOccurrence =
        rule.lastOccurrence && rule.lastOccurrence > now
          ? rule.lastOccurrence
          : toDayString(now);
      rule.nextOccurrence = nextOccurrence;
      rule.isActive = true;
      rule.updatedBy = userId;
      await rule.save();
      res.send({
        message: "Recurring transaction resumed successfully",
        data: rule,
      });
    } catch (error) {
      res.status(errorStatus(error)).send({ error: publicError(error) });
    }
  }
);

// All of the user's recurring rules, active and paused
recurringTransactionRouter.get("/transactions", userAuth, async (req, res) => {
  try {
    const userId = req.user._id;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 10));
    const skip = (page - 1) * limit;

    const filter = { userId };
    const [totalCount, rules] = await Promise.all([
      RecurringTransaction.countDocuments(filter),
      RecurringTransaction.find(filter)
        .sort({ isActive: -1, nextOccurrence: 1 })
        .skip(skip)
        .limit(limit),
    ]);

    const totalPages = Math.ceil(totalCount / limit);
    const hasNextPage = page < totalPages;
    const hasPreviousPage = page > 1;
    res.json({
      message: "Recurring transactions retrieved successfully",
      data: rules,
      pagination: {
        totalCount,
        totalPages,
        hasNextPage,
        hasPreviousPage,
        nextPage: hasNextPage ? page + 1 : null,
        previousPage: hasPreviousPage ? page - 1 : null,
      },
    });
  } catch (error) {
    res.status(errorStatus(error)).send({ error: publicError(error) });
  }
});

export default recurringTransactionRouter;
