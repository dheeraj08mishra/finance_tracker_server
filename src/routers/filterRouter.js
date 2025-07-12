import express from "express";
import userAuth from "../middleware/auth.js";
const filterRouter = express.Router();
import Transaction from "../model/transactions.js";

// filter by note

filterRouter.get("/filter", userAuth, async (req, res) => {
  try {
    const { note, category, fromDate, toDate, sort, tags } = req.query;

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
    // Check if fromDate and toDate are in the future but only date not time
    if (
      fromDate &&
      new Date(fromDate).setHours(0, 0, 0, 0) > new Date().setHours(0, 0, 0, 0)
    ) {
      return res.status(400).json({
        success: false,
        message: "From date cannot be in the future",
      });
    }

    if (
      toDate &&
      new Date(toDate).setHours(0, 0, 0, 0) > new Date().setHours(0, 0, 0, 0)
    ) {
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
      filter.date = {
        $gte: cleanedFromDate,
        $lte: new Date(),
      };
    } else if (cleanedToDate) {
      filter.date = {
        $gte: new Date(0),
        $lte: cleanedToDate,
      };
    }

    let sortOptions = {};
    if (sort) {
      switch (sort.toLowerCase()) {
        case "newesttooldest":
          sortOptions = { createdAt: -1 };
          break;
        case "oldesttonewest":
          sortOptions = { createdAt: 1 };
          break;
        case "highesttolowest":
          sortOptions = { amount: -1 };
          break;
        case "lowesttohighest":
          sortOptions = { amount: 1 };
          break;
        default:
          sortOptions = {};
          break;
      }
    } else {
      sortOptions = { createdAt: -1 };
    }

    const transactions = await Transaction.find(filter).sort(sortOptions);
    return res.status(200).json({
      success: true,
      message: "All transactions retrieved successfully",
      data: {
        transactions,
      },
      pagination: {
        totalTransactions: transactions.length,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

export default filterRouter;
