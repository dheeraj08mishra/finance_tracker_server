import express from "express";
const manualUpdateRecurringRouter = express.Router();
import { manualRecurringSync } from "../utils/cron/manualRecurringTransaction.js";
import RecurringTransaction from "../model/recurringTransaction.js";
manualUpdateRecurringRouter.post("/sync", async (req, res) => {
  try {
    console.log(" Triggered manual sync for recurring transactions.");
    await manualRecurringSync();
    res.status(200).json({ message: "Manual sync completed successfully." });
  } catch (error) {
    console.error(" Error during manual sync:", error);
    res
      .status(500)
      .json({ message: "Error during manual sync", error: error.message });
  }
});
manualUpdateRecurringRouter.get("/recurring-transactions", async (req, res) => {
  try {
    const recurrings = await RecurringTransaction.find({ isActive: true });
    res.status(200).json(recurrings);
  } catch (error) {
    console.error("Error fetching recurring transactions:", error);
    res.status(500).json({
      message: "Error fetching recurring transactions",
      error: error.message,
    });
  }
});

export default manualUpdateRecurringRouter;
