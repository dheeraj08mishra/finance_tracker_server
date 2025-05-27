import express from "express";
import userAuth from "../middleware/auth.js";
const filterRouter = express.Router();
import Transaction from "../model/transactions.js";

// filter by note

filterRouter.get("/filter/note", userAuth, async (req, res) => {
  try {
    const { note } = req.query;

    // incase of no note provided, return all transactions
    if (!note) {
      const transactions = await Transaction.find({
        userId: req.user._id,
      });

      return res.status(200).json({
        success: true,
        message: "All  transactions retrieved successfully",
        data: data,
        pagination: {
          totalTransactions: transactions.length,
        },
      });
    } else {
      const cleanedNote = note?.trim();

      const transactions = await Transaction.find({
        userId: req.user._id,
        note: { $regex: cleanedNote, $options: "i" }, // case-insensitive search
      });
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
    }
  } catch (err) {
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

export default filterRouter;
