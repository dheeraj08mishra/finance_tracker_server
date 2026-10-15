import os from "node:os";
import cron from "node-cron";
import JobRun from "../../model/jobRun.js";
import { processDueRecurring } from "./recurringEngine.js";
import {
  sendTomorrowReminders,
  sendMonthlySummaries,
} from "../notifications.js";

const KEEP_DAYS = 90;
// A run that started this long ago and never finished (crash) may be
// taken over by another process
const STALE_MS = 60 * 60 * 1000;

// true if this process may run `key`; false if another one has it or it
// already ran. Atomic: the document _id is the key.
export async function claimRun(key, now = new Date()) {
  try {
    await JobRun.updateOne(
      // matches only an unfinished run that went stale; otherwise the
      // upsert tries to insert the same _id and fails
      {
        _id: key,
        finishedAt: null,
        startedAt: { $lt: new Date(now - STALE_MS) },
      },
      {
        $set: { startedAt: now, host: os.hostname(), error: null },
        $setOnInsert: {
          expiresAt: new Date(now.getTime() + KEEP_DAYS * 86400e3),
        },
      },
      { upsert: true }
    );
    return true;
  } catch (err) {
    if (err.code === 11000) return false; // someone else's, or done
    throw err;
  }
}

// Runs fn once per key across every process; returns its result, or
// null when skipped
export async function runOnce(key, fn, log = console.log) {
  if (!(await claimRun(key))) {
    log(`[JOBS] ${key}: already handled elsewhere, skipping`);
    return null;
  }
  try {
    const result = await fn();
    await JobRun.updateOne(
      { _id: key },
      { finishedAt: new Date(), result: result ?? null }
    );
    return result ?? true;
  } catch (err) {
    // left unfinished on purpose: after STALE_MS another run may retry it
    await JobRun.updateOne(
      { _id: key },
      { error: String(err?.message || err) }
    );
    throw err;
  }
}

const today = () => new Date().toISOString().slice(0, 10);
const lastMonth = () => {
  const now = new Date();
  const y =
    now.getUTCMonth() === 0 ? now.getUTCFullYear() - 1 : now.getUTCFullYear();
  const m = now.getUTCMonth() === 0 ? 12 : now.getUTCMonth();
  return { y, m, key: `${y}-${String(m).padStart(2, "0")}` };
};

// Reminders for tomorrow, then today's recurring transactions
export const dailyJob = () =>
  runOnce(`daily:${today()}`, async () => {
    const reminders = await sendTomorrowReminders();
    console.log(
      `[JOBS] ${reminders.sent} of ${reminders.due} reminder(s) sent`
    );
    await processDueRecurring();
    return { reminders };
  });

// Last month's summary emails
export const monthlyJob = () => {
  const { y, m, key } = lastMonth();
  return runOnce(`monthly:${key}`, async () => {
    const r = await sendMonthlySummaries(y, m);
    console.log(
      `[JOBS] Monthly summaries: ${r.sent} sent, ${r.skipped} skipped`
    );
    return r;
  });
};

const safely = (name, job) => async () => {
  console.log(`[JOBS] ${name} started at ${new Date().toISOString()}`);
  try {
    await job();
  } catch (error) {
    console.error(`[JOBS] ${name} failed:`, error);
  }
};

// Schedules the jobs in this process; returns a stop function
export function startJobs() {
  const tasks = [
    // 00:00 UTC (05:30 IST)
    cron.schedule("0 0 * * *", safely("Daily job", dailyJob)),
    // 1st of the month, 03:00 UTC (08:30 IST)
    cron.schedule("0 3 1 * *", safely("Monthly summaries", monthlyJob)),
  ];
  console.log(
    "[JOBS] Scheduled: daily 00:00 UTC, monthly summaries 1st 03:00 UTC"
  );
  return () => tasks.forEach((t) => t.stop());
}
