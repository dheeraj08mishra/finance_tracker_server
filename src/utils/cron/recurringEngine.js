import RecurringTransaction from "../../model/recurringTransaction.js";
import Transaction from "../../model/transactions.js";
import { extractTags } from "../tags/extractTags.js";
import { occurrencesBetween, nextOccurrenceAfter } from "../dates.js";

const MAX_CATCH_UP = 100; // per rule per run

const endOfTodayUTC = () => {
  const d = new Date();
  d.setUTCHours(23, 59, 59, 999);
  return d;
};

const endOfDay = (date) => {
  const d = new Date(date);
  d.setUTCHours(23, 59, 59, 999);
  return d;
};

// Creates every due occurrence (missed ones included) for active rules.
// Shared by the daily cron, the /sync route and the CLI script.
// userId limits the run to one user; omit it only from trusted callers.
export async function processDueRecurring({ userId, log = console.log } = {}) {
  const todayEnd = endOfTodayUTC();
  const rules = await RecurringTransaction.find({
    ...(userId && { userId }),
    isActive: true,
    nextOccurrence: { $lte: todayEnd },
  });
  log(`[RECURRING] ${rules.length} rule(s) due`);

  let created = 0;
  for (const rule of rules) {
    const after = rule.lastOccurrence || rule.startDate;
    const until =
      rule.endDate && rule.endDate < todayEnd ? endOfDay(rule.endDate) : todayEnd;
    const dueDates = occurrencesBetween(
      rule.frequency,
      rule.startDate,
      after,
      until,
      MAX_CATCH_UP
    );

    if (dueDates.length && !rule.tags?.length && rule.note?.trim()) {
      rule.tags = await extractTags(rule.note); // returns [] on failure
    }

    for (const date of dueDates) {
      try {
        await Transaction.create({
          userId: rule.userId,
          type: rule.type,
          amount: rule.amount,
          category: rule.category,
          note: rule.note,
          date,
          isRecurring: true,
          frequency: rule.frequency,
          tags: rule.tags,
          recurringTransactionId: rule._id,
        });
        created++;
      } catch (err) {
        // Unique index on (recurringTransactionId, date): already created
        if (err.code !== 11000) {
          console.error(`[RECURRING] rule=${rule._id} date=${date.toISOString()}:`, err);
        }
      }
    }

    if (dueDates.length) rule.lastOccurrence = dueDates[dueDates.length - 1];
    rule.nextOccurrence = nextOccurrenceAfter(
      rule.frequency,
      rule.startDate,
      rule.lastOccurrence || after
    );
    if (rule.endDate && rule.nextOccurrence > endOfDay(rule.endDate)) {
      rule.isActive = false;
      rule.nextOccurrence = null;
      log(`[RECURRING] rule=${rule._id} ended (past endDate)`);
    }
    await rule.save();
  }
  log(`[RECURRING] created ${created} transaction(s)`);
  return { rules: rules.length, created };
}
