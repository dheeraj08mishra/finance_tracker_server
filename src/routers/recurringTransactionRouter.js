import express from "express";
import validator from "validator";
import { publicError, errorStatus } from "../utils/errors.js";
import RecurringTransaction from "../model/recurringTransaction.js";
import userAuth from "../middleware/auth.js";
import {
  toDayString,
  nextOccurrenceAfter,
  nextActiveOccurrence,
  USER_FREQUENCIES,
} from "../utils/dates.js";
import { MAX_AMOUNT, parseAmount } from "../utils/money.js";
import { recurringInsights } from "../utils/recurringInsights.js";

const endOfDay = (date) => {
  const d = new Date(date);
  d.setUTCHours(23, 59, 59, 999);
  return d;
};

// Ends the rule if its next date is past its end date
const applyEndDate = (rule) => {
  if (rule.endDate && rule.nextOccurrence > endOfDay(rule.endDate)) {
    rule.isActive = false;
    rule.nextOccurrence = null;
  }
};

const recurringTransactionRouter = express.Router();

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
      const nextOccurrence = nextActiveOccurrence(rule, after);
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

// Committed per month, payments in the next 30 days, price changes
recurringTransactionRouter.get("/insights", userAuth, async (req, res) => {
  try {
    res.json(await recurringInsights(req.user._id));
  } catch (error) {
    res.status(errorStatus(error)).send({ error: publicError(error) });
  }
});

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

// Edit a series. Changes apply to future occurrences only; transactions
// already created stay as they are.
recurringTransactionRouter.patch(
  "/transaction/:id",
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
      const { amount, note, category, type, frequency, endDate } = req.body;
      const bad = (error) => res.status(400).send({ error });

      if (amount !== undefined) {
        const n = parseAmount(amount);
        if (n === null)
          return bad(`Amount must be a positive number up to ${MAX_AMOUNT}`);
        rule.amount = n;
      }
      if (note !== undefined) {
        if (typeof note !== "string") return bad("Invalid note");
        if (note.trim() !== rule.note) {
          rule.note = note.trim();
          rule.tags = []; // tags come from the note: re-extract next time
        }
      }
      if (type !== undefined) rule.type = type; // checked by the schema
      if (category !== undefined) rule.category = category;

      let frequencyChanged = false;
      if (frequency !== undefined && frequency !== rule.frequency) {
        if (!USER_FREQUENCIES.includes(frequency)) {
          return bad(
            `Frequency must be one of: ${USER_FREQUENCIES.join(", ")}`
          );
        }
        rule.frequency = frequency;
        frequencyChanged = true;
      }
      if (endDate !== undefined) {
        if (endDate === null || endDate === "") {
          rule.endDate = null;
        } else {
          if (!validator.isISO8601(String(endDate)))
            return bad("Invalid end date");
          if (toDayString(endDate) < toDayString(rule.startDate)) {
            return bad("End date can't be before the start date");
          }
          rule.endDate = toDayString(endDate);
        }
      }

      if (rule.isActive) {
        if (frequencyChanged) {
          // Continue from today on the new schedule: never back-fill dates
          // the old schedule didn't have
          const today = toDayString(new Date());
          if (
            !rule.lastOccurrence ||
            toDayString(rule.lastOccurrence) < today
          ) {
            rule.lastOccurrence = today;
          }
        }
        rule.nextOccurrence = nextActiveOccurrence(
          rule,
          rule.lastOccurrence || rule.startDate
        );
        applyEndDate(rule);
      }
      rule.updatedBy = userId;
      await rule.save();
      res.send({ message: "Recurring transaction updated", data: rule });
    } catch (error) {
      res.status(errorStatus(error)).send({ error: publicError(error) });
    }
  }
);

// Skip only the next occurrence; the series continues after it
recurringTransactionRouter.post(
  "/skipTransaction/:id",
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
      if (!rule.isActive || !rule.nextOccurrence) {
        return res
          .status(400)
          .send({ error: "There is no upcoming payment to skip." });
      }
      const skipped = rule.nextOccurrence;
      rule.skipDates.push(skipped);
      rule.nextOccurrence = nextActiveOccurrence(rule, skipped);
      applyEndDate(rule);
      rule.updatedBy = userId;
      await rule.save();
      res.send({
        message: rule.nextOccurrence
          ? `Skipped ${toDayString(skipped)}. Next: ${toDayString(rule.nextOccurrence)}.`
          : `Skipped ${toDayString(skipped)}. That was the last one.`,
        data: rule,
        skipped,
      });
    } catch (error) {
      res.status(errorStatus(error)).send({ error: publicError(error) });
    }
  }
);

// Delete a series. Transactions it already created stay in the history.
recurringTransactionRouter.delete(
  "/transaction/:id",
  userAuth,
  async (req, res) => {
    try {
      const rule = await RecurringTransaction.findOneAndDelete({
        _id: req.params.id,
        userId: req.user._id,
      });
      if (!rule) {
        return res
          .status(404)
          .send({ error: "Recurring transaction not found" });
      }
      res.send({
        message: "Recurring transaction deleted. Past transactions were kept.",
      });
    } catch (error) {
      res.status(errorStatus(error)).send({ error: publicError(error) });
    }
  }
);

export default recurringTransactionRouter;
