import express from "express";
const manualUpdateRecurringRouter = express.Router();
import { manualRecurringSync } from "../utils/cron/manualRecurringTransaction.js";
import RecurringTransaction from "../model/recurringTransaction.js";
import userAuth from "../middleware/auth.js";

// Sync only the logged-in user's recurring transactions
manualUpdateRecurringRouter.post("/sync", userAuth, async (req, res) => {
  try {
    console.log(`Triggered manual sync for user=${req.user._id}`);
    await manualRecurringSync(req.user._id);
    res.status(200).json({ message: "Manual sync completed successfully." });
  } catch (error) {
    console.error(" Error during manual sync:", error);
    res.status(500).json({ message: "Error during manual sync" });
  }
});

manualUpdateRecurringRouter.get(
  "/recurring-transactions",
  userAuth,
  async (req, res) => {
    try {
      const recurrings = await RecurringTransaction.find({
        userId: req.user._id,
        isActive: true,
      });
      res.status(200).json(recurrings);
    } catch (error) {
      console.error("Error fetching recurring transactions:", error);
      res
        .status(500)
        .json({ message: "Error fetching recurring transactions" });
    }
  }
);

export default manualUpdateRecurringRouter;
