import express from "express";
import userAuth from "../middleware/auth.js";
const filterRouter = express.Router();
import Transaction from "../model/transactions.js";
import { isFutureDay } from "../utils/dates.js";

// filter by note

filterRouter.get("/filter", userAuth, async (req, res) => {
  try {
    const { note, category, fromDate, toDate, sort } = req.query;

    const cleanedNote = note?.trim();
    if (cleanedNote && cleanedNote.length > 100) {
      return res.status(400).json({
        success: false,
        message: "Note exceeds maximum length of 100 characters",
      });
    }
    if (cleanedNote && !/^[a-zA-Z0-9\s]+$/.test(cleanedNote)) {
      return res.status(400).json({
        success: false,
        message: "Note can only contain alphanumeric characters and spaces",
      });
    }
    if (
      category &&
      !["need", "want", "investment", "other"].includes(category.toLowerCase())
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid category. Allowed categories are: need, want, investment, other",
      });
    }
    if (fromDate && isNaN(Date.parse(fromDate))) {
      return res.status(400).json({
        success: false,
        message: "Invalid date format",
      });
    }
    if (toDate && isNaN(Date.parse(toDate))) {
      return res.status(400).json({
        success: false,
        message: "Invalid date format",
      });
    }
    if (fromDate && toDate && new Date(fromDate) > new Date(toDate)) {
      return res.status(400).json({
        success: false,
        message: "From date cannot be later than To date",
      });
    }
    // Future = a day that has not started anywhere yet (users ahead of UTC,
    // e.g. IST after midnight, send their own "today")
    if (fromDate && isFutureDay(fromDate)) {
      return res.status(400).json({
        success: false,
        message: "From date cannot be in the future",
      });
    }

    if (toDate && isFutureDay(toDate)) {
      return res.status(400).json({
        success: false,
        message: "To date cannot be in the future",
      });
    }

    if (
      sort &&
      ![
        "newesttooldest",
        "oldesttonewest",
        "highesttolowest",
        "lowesttohighest",
      ].includes(sort.toLowerCase())
    ) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid sort option" });
    }

    const lowercaseCategory = category?.toLowerCase();
    const cleanedFromDate = fromDate ? new Date(fromDate) : null;
    const cleanedToDate = toDate ? new Date(toDate) : null;
    if (cleanedToDate) {
      cleanedToDate.setHours(23, 59, 59, 999); // Set to end of the day
    }

    const filter = { userId: req.user._id };
    if (cleanedNote) {
      filter.note = { $regex: cleanedNote, $options: "i" };
    }
    if (lowercaseCategory) {
      filter.category = lowercaseCategory;
    }

    if (cleanedFromDate && cleanedToDate) {
      filter.date = {
        $gte: cleanedFromDate,
        $lte: cleanedToDate,
      };
    } else if (cleanedFromDate) {
      // No upper bound: "now" in UTC would hide today's entries for IST users
      filter.date = { $gte: cleanedFromDate };
    } else if (cleanedToDate) {
      filter.date = {
        $gte: new Date(0),
        $lte: cleanedToDate,
      };
    }

    // By transaction date, then when it was added; _id last so the order is
    // total and pages never repeat or skip a row
    const SORTS = {
      newesttooldest: { date: -1, createdAt: -1, _id: -1 },
      oldesttonewest: { date: 1, createdAt: 1, _id: 1 },
      highesttolowest: { amount: -1, date: -1, _id: -1 },
      lowesttohighest: { amount: 1, date: -1, _id: -1 },
    };
    const sortOptions = SORTS[sort?.toLowerCase()] || SORTS.newesttooldest;

    // Paging is opt-in: without page/limit/offset everything is returned
    // (as before). `offset` = rows the client already has, so "load more"
    // stays exact even after the user deleted rows on screen.
    const paged = ["page", "limit", "offset"].some(
      (k) => req.query[k] !== undefined
    );
    const page = Number(req.query.page ?? 1);
    const limit = Number(req.query.limit ?? 25);
    const offset =
      req.query.offset !== undefined
        ? Number(req.query.offset)
        : (page - 1) * limit;
    if (
      paged &&
      (!Number.isInteger(page) ||
        page < 1 ||
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > 100 ||
        !Number.isInteger(offset) ||
        offset < 0)
    ) {
      return res.status(400).json({
        success: false,
        message: "page must be 1 or more, limit 1-100 and offset 0 or more",
      });
    }

    let query = Transaction.find(filter).sort(sortOptions);
    if (paged) query = query.skip(offset).limit(limit);

    // Count and net total cover every match, not just this page
    const [transactions, [totals]] = await Promise.all([
      query,
      Transaction.aggregate([
        { $match: filter },
        {
          $group: {
            _id: null,
            count: { $sum: 1 },
            net: {
              $sum: {
                $cond: [
                  { $in: ["$type", ["income", "credit"]] },
                  "$amount",
                  { $multiply: ["$amount", -1] },
                ],
              },
            },
          },
        },
      ]),
    ]);
    const totalTransactions = totals?.count || 0;

    return res.status(200).json({
      success: true,
      message: "Transactions retrieved successfully",
      data: {
        transactions,
      },
      pagination: {
        totalTransactions,
        net: totals?.net || 0,
        ...(paged && {
          page,
          limit,
          offset,
          totalPages: Math.ceil(totalTransactions / limit),
          hasMore: offset + transactions.length < totalTransactions,
        }),
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

export default filterRouter;
