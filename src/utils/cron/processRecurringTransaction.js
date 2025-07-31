import RecurringTransaction from "../../model/recurringTransaction.js";
import Transaction from "../../model/transactions.js";
import cron from "node-cron";
import { addDays, addWeeks, addMonths, addYears } from "date-fns";
import User from "../../model/user.js";
import { sendRecurringTransactionEmail } from "../autoEmail/mailer.js";
import { extractTags } from "../tags/extractTags.js";

function getNextOccurrence(frequency, baseDate) {
  const base = new Date(baseDate);
  switch (frequency) {
    case "daily":
      return addDays(base, 1);
    case "weekly":
      return addWeeks(base, 1);
    case "monthly":
      return addMonths(base, 1);
    case "yearly":
      return addYears(base, 1);
    default:
      return null;
  }
}

cron.schedule("0 0 * * *", async () => {
  try {
    const now = new Date();
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);

    const tomorrow = addDays(today, 1);
    const tomorrowStart = new Date(tomorrow);
    tomorrowStart.setHours(0, 0, 0, 0);
    const tomorrowEnd = new Date(tomorrow);
    tomorrowEnd.setHours(23, 59, 59, 999);

    const reminders = await RecurringTransaction.find({
      isActive: true,
      nextOccurrence: { $gte: tomorrowStart, $lte: tomorrowEnd },
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
          true
        );
      }
    }

    // Step 2: Process today's due recurring transactions (due today)
    const todayEnd = new Date(today);
    todayEnd.setHours(23, 59, 59, 999);

    const recurringTransactions = await RecurringTransaction.find({
      isActive: true,
      nextOccurrence: { $gte: today, $lte: todayEnd },
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

      let tags = [];

      if (
        (!rt.tags || !rt.tags.length) &&
        rt.note &&
        rt.note.trim().length > 0
      ) {
        try {
          tags = await extractTags(rt.note);
          rt.tags = tags;
          await rt.save();
        } catch (error) {
          console.error("Error extracting tags:", error);
        }
      } else {
        tags = rt.tags || [];
      }

      // Create the transaction for today
      const newTransaction = new Transaction({
        userId: rt.userId,
        type: rt.type,
        amount: rt.amount,
        category: rt.category,
        note: rt.note,
        date: rt.nextOccurrence,
        isRecurring: true,
        frequency: rt.frequency,
        tags: tags,
        createdBy: rt.userId,
        updatedBy: rt.userId,
        recurringTransactionId: rt._id,
      });

      await newTransaction.save();

      // Update recurring transaction's next and last occurrences
      rt.lastOccurrence = rt.nextOccurrence;
      rt.nextOccurrence = getNextOccurrence(rt.frequency, rt.nextOccurrence);

      // If the next occurrence is past endDate, deactivate
      if (rt.endDate && rt.nextOccurrence > rt.endDate) {
        rt.isActive = false;
      }
      await rt.save();
    }
  } catch (error) {
    console.error("Error processing recurring transactions:", error);
  }
});

export default cron;
