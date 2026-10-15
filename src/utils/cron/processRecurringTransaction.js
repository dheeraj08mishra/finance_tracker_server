import cron from "node-cron";
import { processDueRecurring } from "./recurringEngine.js";
import {
  sendTomorrowReminders,
  sendMonthlySummaries,
} from "../notifications.js";

// Daily at 00:00 UTC (05:30 IST): reminders, then create due transactions
cron.schedule("0 0 * * *", async () => {
  console.log(`[CRON] Daily job started at ${new Date().toISOString()}`);
  try {
    const r = await sendTomorrowReminders();
    console.log(`[CRON] ${r.sent} of ${r.due} reminder(s) sent`);
    await processDueRecurring();
  } catch (error) {
    console.error("[CRON] Daily job failed:", error);
  }
});

// 1st of the month at 03:00 UTC (08:30 IST): last month's summaries
cron.schedule("0 3 1 * *", async () => {
  const now = new Date();
  const year =
    now.getUTCMonth() === 0 ? now.getUTCFullYear() - 1 : now.getUTCFullYear();
  const month = now.getUTCMonth() === 0 ? 12 : now.getUTCMonth();
  try {
    const r = await sendMonthlySummaries(year, month);
    console.log(
      `[CRON] Monthly summaries: ${r.sent} sent, ${r.skipped} skipped`
    );
  } catch (error) {
    console.error("[CRON] Monthly summaries failed:", error);
  }
});

export default cron;
