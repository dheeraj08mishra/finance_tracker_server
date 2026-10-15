import express from "express";
import userAuth from "../middleware/auth.js";
import requireAdmin from "../middleware/requireAdmin.js";
import User from "../model/user.js";
import Transaction from "../model/transactions.js";
import Feedback from "../model/feedback.js";
import { publicError, errorStatus } from "../utils/errors.js";

// Read-only admin endpoints: nothing here changes data
const adminRouter = express.Router();
adminRouter.use(userAuth, requireAdmin);

const FEEDBACK_TYPES = ["bug", "feature", "suggestion", "other"];
const daysAgo = (n) => new Date(Date.now() - n * 86400e3);

adminRouter.get("/stats", async (req, res) => {
  try {
    const [users, newThisWeek, activeIds, transactions, feedbackByType] =
      await Promise.all([
        User.countDocuments(),
        User.countDocuments({ createdAt: { $gte: daysAgo(7) } }),
        // "active" = added a transaction in the last 30 days
        Transaction.distinct("userId", { createdAt: { $gte: daysAgo(30) } }),
        Transaction.estimatedDocumentCount(),
        Feedback.aggregate([
          { $group: { _id: "$feedbackType", count: { $sum: 1 } } },
        ]),
      ]);
    const feedback = Object.fromEntries(FEEDBACK_TYPES.map((t) => [t, 0]));
    for (const row of feedbackByType) feedback[row._id] = row.count;
    res.json({
      users,
      newThisWeek,
      activeLast30Days: activeIds.length,
      transactions,
      feedback: {
        ...feedback,
        total: Object.values(feedback).reduce((a, b) => a + b, 0),
      },
    });
  } catch (error) {
    res.status(errorStatus(error)).json({ message: publicError(error) });
  }
});

adminRouter.get("/feedback", async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
    const { type } = req.query;
    if (type && !FEEDBACK_TYPES.includes(type)) {
      return res.status(400).json({ message: "Unknown feedback type" });
    }
    const filter = type ? { feedbackType: type } : {};
    const [total, items] = await Promise.all([
      Feedback.countDocuments(filter),
      Feedback.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate("UserId", "firstName lastName email")
        .lean(),
    ]);
    res.json({
      data: items.map((f) => ({
        _id: f._id,
        type: f.feedbackType,
        text: f.feedbackText,
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
    res.status(errorStatus(error)).json({ message: publicError(error) });
  }
});

export default adminRouter;
