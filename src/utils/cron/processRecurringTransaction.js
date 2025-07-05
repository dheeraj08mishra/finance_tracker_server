import RecurringTransaction from "../../model/recurringTransaction.js";
import Transaction from "../../model/transactions.js";
import cron from "node-cron";
import { addDays, addWeeks, addMonths, addYears } from "date-fns";
import User from "../../model/user.js";
import { sendRecurringTransactionEmail } from "../autoEmail/mailer.js";

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
    const today = new Date();
    const tomorrow = addDays(today, 1);

    const tomorrowStart = new Date(tomorrow);
    tomorrowStart.setHours(0, 0, 0, 0);

    const tomorrowEnd = new Date(tomorrow);
    tomorrowEnd.setHours(23, 59, 59, 999);

    // Step 1: Send reminder emails for tomorrow’s transactions
    const reminders = await RecurringTransaction.find({
      isActive: true,
      nextOccurrence: { $gte: tomorrowStart, $lt: tomorrowEnd },
    });

    for (const rt of reminders) {
      const user = await User.findById(rt.userId);
      if (user?.email) {
        await sendRecurringTransactionEmail(
          user.email,
          {
            amount: rt.amount,
            category: rt.category,
            note: rt.note,
            date: rt.nextOccurrence,
          },
          true // isReminder = true
        );
      }
    }

    // Step 2: Process today's due recurring transactions
    const recurringTransactions = await RecurringTransaction.find({
      isActive: true,
      nextOccurrence: { $lte: today },
      $or: [
        { endDate: { $exists: false } },
        { endDate: null },
        { endDate: { $gte: today } },
      ],
    });

    for (const rt of recurringTransactions) {
      if (rt.endDate && rt.nextOccurrence > rt.endDate) {
        rt.isActive = false;
        await rt.save();
        continue;
      }

      const newTransaction = new Transaction({
        userId: rt.userId,
        type: rt.type,
        amount: rt.amount,
        category: rt.category,
        note: rt.note,
        date: rt.nextOccurrence,
        isRecurring: true,
        frequency: rt.frequency,
      });

      await newTransaction.save();

      rt.lastOccurrence = rt.nextOccurrence;
      rt.nextOccurrence = getNextOccurrence(rt.frequency, rt.nextOccurrence);
      await rt.save();
    }
  } catch (error) {
    console.error("Error processing recurring transactions:", error);
  }
});

export default cron;
