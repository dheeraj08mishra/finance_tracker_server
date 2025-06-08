import RecurringTransaction from "../../model/recurringTransaction.js";
import Transaction from "../../model/transactions.js";
import cron from "node-cron";
import { addDays, addWeeks, addMonths, addYears } from "date-fns";

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

cron.schedule("0 0 * * *", async () => {
  try {
    const now = new Date();
    const recurringTransactions = await RecurringTransaction.find({
      isActive: true,
      nextOccurrence: { $lte: now },
      $or: [
        { endDate: { $exists: false } },
        { endDate: null },
        { endDate: { $gte: now } },
      ],
    });

    for (const rt of recurringTransactions) {
      // Only create a transaction if nextOccurrence is not beyond endDate (if set)
      if (rt.endDate && rt.nextOccurrence > rt.endDate) {
        rt.isActive = false;
        await rt.save();
        continue;
      }

      // Create the transaction for the scheduled date
      const newTransaction = new Transaction({
        userId: rt.userId,
        type: rt.type,
        amount: rt.amount,
        category: rt.category,
        note: rt.note,
        date: rt.nextOccurrence, // Use the scheduled date
        isRecurring: true,
        frequency: rt.frequency,
      });

      await newTransaction.save();

      // Update last and next occurrence
      rt.lastOccurrence = rt.nextOccurrence;
      rt.nextOccurrence = getNextOccurrence(rt.frequency, rt.nextOccurrence);
      await rt.save();
    }
  } catch (error) {
    console.error("Error processing recurring transactions:", error);
  }
});
export default cron;
