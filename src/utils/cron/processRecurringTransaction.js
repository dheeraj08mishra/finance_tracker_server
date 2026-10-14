import RecurringTransaction from "../../model/recurringTransaction.js";
import cron from "node-cron";
import { addDays } from "date-fns";
import User from "../../model/user.js";
import { sendRecurringTransactionEmail } from "../autoEmail/mailer.js";
import { processDueRecurring } from "./recurringEngine.js";

// Email users about recurring transactions due tomorrow (UTC day)
async function sendTomorrowReminders() {
  const tomorrowStart = addDays(new Date(), 1);
  tomorrowStart.setUTCHours(0, 0, 0, 0);
  const tomorrowEnd = new Date(tomorrowStart);
  tomorrowEnd.setUTCHours(23, 59, 59, 999);

  const reminders = await RecurringTransaction.find({
    isActive: true,
    nextOccurrence: { $gte: tomorrowStart, $lte: tomorrowEnd },
  });
  console.log(`[CRON] ${reminders.length} reminder(s) for tomorrow`);

  for (const rt of reminders) {
    const user = await User.findById(rt.userId);
    if (!user?.email) continue;
    try {
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
    } catch (err) {
      console.error(`[CRON] Reminder failed for recurringTxn=${rt._id}:`, err);
    }
  }
}

// Daily at 00:00 UTC (05:30 IST)
cron.schedule("0 0 * * *", async () => {
  console.log(`[CRON] Recurring job started at ${new Date().toISOString()}`);
  try {
    await sendTomorrowReminders();
    await processDueRecurring();
  } catch (error) {
    console.error("[CRON] Recurring job failed:", error);
  }
});

export default cron;
