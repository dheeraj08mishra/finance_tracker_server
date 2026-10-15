import express from "express";
import mongoose from "mongoose";
import userAuth from "../middleware/auth.js";
import requireAdmin from "../middleware/requireAdmin.js";
import User from "../model/user.js";
import Transaction from "../model/transactions.js";
import Feedback from "../model/feedback.js";
import Goal from "../model/goal.js";
import RecurringTransaction from "../model/recurringTransaction.js";
import { publicError, errorStatus } from "../utils/errors.js";

// Admin endpoints. Read-only for everything users own; the only write is
// triaging feedback (status + private note).
const adminRouter = express.Router();
adminRouter.use(userAuth, requireAdmin);

const FEEDBACK_TYPES = ["bug", "feature", "suggestion", "other"];
const FEEDBACK_STATUSES = ["new", "seen", "done"];
const daysAgo = (n) => new Date(Date.now() - n * 86400e3);
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const paging = (q, max = 50, def = 20) => {
  const page = Math.max(1, parseInt(q.page) || 1);
  const limit = Math.min(max, Math.max(1, parseInt(q.limit) || def));
  return { page, limit, skip: (page - 1) * limit };
};
const fail = (res, error) =>
  res.status(errorStatus(error)).json({ message: publicError(error) });

adminRouter.get("/stats", async (req, res) => {
  try {
    const [users, newThisWeek, activeIds, transactions, byType, newFeedback] =
      await Promise.all([
        User.countDocuments(),
        User.countDocuments({ createdAt: { $gte: daysAgo(7) } }),
        // "active" = added a transaction in the last 30 days
        Transaction.distinct("userId", { createdAt: { $gte: daysAgo(30) } }),
        Transaction.estimatedDocumentCount(),
        Feedback.aggregate([
          { $group: { _id: "$feedbackType", count: { $sum: 1 } } },
        ]),
        Feedback.countDocuments({ status: { $in: ["new", null] } }),
      ]);
    const feedback = Object.fromEntries(FEEDBACK_TYPES.map((t) => [t, 0]));
    for (const row of byType) feedback[row._id] = row.count;
    res.json({
      users,
      newThisWeek,
      activeLast30Days: activeIds.length,
      transactions,
      feedback: {
        ...feedback,
        total: Object.values(feedback).reduce((a, b) => a + b, 0),
        new: newFeedback,
      },
    });
  } catch (error) {
    fail(res, error);
  }
});

// Sign-ups per week, active users per month, and a few totals
adminRouter.get("/activity", async (req, res) => {
  try {
    const WEEKS = 12;
    const MONTHS = 6;
    const now = new Date();
    // weeks start on Monday (UTC)
    const thisMonday = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
    );
    thisMonday.setUTCDate(
      thisMonday.getUTCDate() - ((thisMonday.getUTCDay() + 6) % 7)
    );
    const firstWeek = new Date(
      thisMonday.getTime() - (WEEKS - 1) * 7 * 86400e3
    );
    const firstMonth = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (MONTHS - 1), 1)
    );

    const [signups, active, goals, recurring, withBudgets] = await Promise.all([
      User.aggregate([
        { $match: { createdAt: { $gte: firstWeek } } },
        {
          $group: {
            _id: {
              $floor: {
                $divide: [
                  { $subtract: ["$createdAt", firstWeek] },
                  7 * 86400e3,
                ],
              },
            },
            count: { $sum: 1 },
          },
        },
      ]),
      Transaction.aggregate([
        { $match: { createdAt: { $gte: firstMonth } } },
        {
          $group: {
            _id: {
              y: { $year: "$createdAt" },
              m: { $month: "$createdAt" },
              u: "$userId",
            },
          },
        },
        { $group: { _id: { y: "$_id.y", m: "$_id.m" }, count: { $sum: 1 } } },
      ]),
      Goal.estimatedDocumentCount(),
      RecurringTransaction.countDocuments({ isActive: true }),
      User.countDocuments({
        $or: ["need", "want", "investment", "other"].map((c) => ({
          [`budgets.${c}`]: { $gt: 0 },
        })),
      }),
    ]);

    const signupsPerWeek = Array.from({ length: WEEKS }, (_, i) => ({
      weekStart: new Date(firstWeek.getTime() + i * 7 * 86400e3)
        .toISOString()
        .slice(0, 10),
      count: signups.find((s) => s._id === i)?.count || 0,
    }));
    const activePerMonth = Array.from({ length: MONTHS }, (_, i) => {
      const d = new Date(
        Date.UTC(firstMonth.getUTCFullYear(), firstMonth.getUTCMonth() + i, 1)
      );
      const y = d.getUTCFullYear();
      const m = d.getUTCMonth() + 1;
      return {
        month: `${y}-${String(m).padStart(2, "0")}`,
        count: active.find((a) => a._id.y === y && a._id.m === m)?.count || 0,
      };
    });
    res.json({
      signupsPerWeek,
      activePerMonth,
      totals: {
        goals,
        activeRecurring: recurring,
        usersWithBudgets: withBudgets,
      },
    });
  } catch (error) {
    fail(res, error);
  }
});

// Read-only list of accounts. No money amounts, no access to anyone's
// transactions: just enough to see who uses the app and how much.
adminRouter.get("/users", async (req, res) => {
  try {
    const { page, limit, skip } = paging(req.query);
    const search = String(req.query.search || "")
      .trim()
      .slice(0, 60);
    const filter = search
      ? {
          $or: ["email", "firstName", "lastName"].map((f) => ({
            [f]: { $regex: escapeRegex(search), $options: "i" },
          })),
        }
      : {};
    const [total, users] = await Promise.all([
      User.countDocuments(filter),
      User.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .select("firstName lastName email role createdAt lastLoginAt")
        .lean(),
    ]);
    const usage = await Transaction.aggregate([
      { $match: { userId: { $in: users.map((u) => u._id) } } },
      {
        $group: {
          _id: "$userId",
          transactions: { $sum: 1 },
          lastTransactionAt: { $max: "$createdAt" },
        },
      },
    ]);
    const byId = Object.fromEntries(usage.map((u) => [String(u._id), u]));
    res.json({
      data: users.map((u) => ({
        _id: u._id,
        name: `${u.firstName} ${u.lastName}`,
        email: u.email,
        role: u.role || "user",
        joinedAt: u.createdAt,
        lastLoginAt: u.lastLoginAt || null,
        transactions: byId[String(u._id)]?.transactions || 0,
        lastTransactionAt: byId[String(u._id)]?.lastTransactionAt || null,
      })),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    fail(res, error);
  }
});

adminRouter.get("/feedback", async (req, res) => {
  try {
    const { page, limit, skip } = paging(req.query);
    const { type, status } = req.query;
    if (type && !FEEDBACK_TYPES.includes(type)) {
      return res.status(400).json({ message: "Unknown feedback type" });
    }
    if (status && !FEEDBACK_STATUSES.includes(status)) {
      return res.status(400).json({ message: "Unknown feedback status" });
    }
    const filter = {
      ...(type && { feedbackType: type }),
      // feedback from before triage existed has no status: it counts as new
      ...(status && {
        status: status === "new" ? { $in: ["new", null] } : status,
      }),
    };
    const [total, items] = await Promise.all([
      Feedback.countDocuments(filter),
      Feedback.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate("UserId", "firstName lastName email")
        .lean(),
    ]);
    res.json({
      data: items.map((f) => ({
        _id: f._id,
        type: f.feedbackType,
        text: f.feedbackText,
        status: f.status || "new",
        adminNote: f.adminNote || "",
        handledAt: f.handledAt || null,
        createdAt: f.createdAt,
        // the account may have been deleted since
        user: f.UserId
          ? {
              name: `${f.UserId.firstName} ${f.UserId.lastName}`,
              email: f.UserId.email,
            }
          : null,
      })),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    fail(res, error);
  }
});

// Triage one piece of feedback: { status?: new|seen|done, note?: string }
adminRouter.patch("/feedback/:id", async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid id" });
    }
    const { status, note } = req.body || {};
    if (status === undefined && note === undefined) {
      return res.status(400).json({ message: "Send a status and/or a note" });
    }
    if (status !== undefined && !FEEDBACK_STATUSES.includes(status)) {
      return res
        .status(400)
        .json({ message: "Status must be new, seen or done" });
    }
    if (note !== undefined && (typeof note !== "string" || note.length > 500)) {
      return res
        .status(400)
        .json({ message: "Note must be text up to 500 characters" });
    }
    const update = {
      handledBy: req.user._id,
      handledAt: new Date(),
      ...(status !== undefined && { status }),
      ...(note !== undefined && { adminNote: note.trim() }),
    };
    const f = await Feedback.findByIdAndUpdate(req.params.id, update, {
      new: true,
      runValidators: true,
    });
    if (!f) return res.status(404).json({ message: "Feedback not found" });
    res.json({
      message: "Feedback updated",
      data: {
        _id: f._id,
        status: f.status,
        adminNote: f.adminNote,
        handledAt: f.handledAt,
      },
    });
  } catch (error) {
    fail(res, error);
  }
});

export default adminRouter;
