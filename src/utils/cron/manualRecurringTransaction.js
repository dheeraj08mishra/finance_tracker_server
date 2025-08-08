import RecurringTransaction from "../../model/recurringTransaction.js";
import Transaction from "../../model/transactions.js";
import { extractTags } from "../../utils/tags/extractTags.js";
import { addDays, addWeeks, addMonths, addYears } from "date-fns";

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

function getMissedOccurrences(frequency, start, today, endDate) {
  let dates = [];
  let next = new Date(start);
  let maxLoop = 100; // Increase limit for manual catchup
  for (let i = 0; i < maxLoop; i++) {
    next = getNextOccurrence(frequency, next);
    if (!next || next > today) break;
    if (endDate && next > endDate) break;
    dates.push(new Date(next));
  }
  return dates;
}

export async function manualRecurringSync() {
  console.log(`[MANUAL SYNC] Job started at ${new Date().toISOString()}`);
  try {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const todayEnd = new Date(now);
    todayEnd.setHours(23, 59, 59, 999);

    const recurrings = await RecurringTransaction.find({
      isActive: true,
      nextOccurrence: { $lte: todayEnd },
      $or: [
        { endDate: { $exists: false } },
        { endDate: null },
        { endDate: { $gte: now } },
      ],
    });

    console.log(
      `[MANUAL SYNC] Found ${recurrings.length} recurring transactions to process.`
    );

    for (const rt of recurrings) {
      const missedDates = [];
      if (rt.nextOccurrence && rt.nextOccurrence <= todayEnd) {
        missedDates.push(new Date(rt.nextOccurrence));
        missedDates.push(
          ...getMissedOccurrences(
            rt.frequency,
            rt.nextOccurrence,
            todayEnd,
            rt.endDate
          )
        );
      }

      for (const txnDate of missedDates) {
        const exists = await Transaction.exists({
          recurringTransactionId: rt._id,
          date: {
            $gte: new Date(new Date(txnDate).setHours(0, 0, 0, 0)),
            $lte: new Date(new Date(txnDate).setHours(23, 59, 59, 999)),
          },
        });
        if (exists) {
          console.log(
            `[MANUAL SYNC] Transaction already exists for recurringTxn=${
              rt._id
            } on ${txnDate.toISOString()}`
          );
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
            console.error(
              `[MANUAL SYNC] Error extracting tags for recurringTxn=${rt._id}:`,
              error
            );
          }
        } else {
          tags = rt.tags || [];
        }

        const newTransaction = new Transaction({
          userId: rt.userId,
          type: rt.type,
          amount: rt.amount,
          category: rt.category,
          note: rt.note,
          date: txnDate,
          isRecurring: true,
          frequency: rt.frequency,
          tags: tags,
          createdBy: rt.userId,
          updatedBy: rt.userId,
          recurringTransactionId: rt._id,
        });

        try {
          await newTransaction.save();
          console.log(
            `[MANUAL SYNC] Added transaction for recurringTxn=${
              rt._id
            } on ${txnDate.toISOString()}`
          );
        } catch (err) {
          console.error(
            `[MANUAL SYNC] Failed to add transaction for recurringTxn=${
              rt._id
            } on ${txnDate.toISOString()}:`,
            err.message,
            err.errors
          );
          console.error("Transaction attempted:", newTransaction.toObject());
        }
      }

      if (missedDates.length > 0) {
        rt.lastOccurrence = missedDates[missedDates.length - 1];
        rt.nextOccurrence = getNextOccurrence(rt.frequency, rt.lastOccurrence);
        if (rt.endDate && rt.nextOccurrence > rt.endDate) {
          rt.isActive = false;
          console.log(
            `[MANUAL SYNC] Deactivated recurringTxn=${rt._id} because nextOccurrence is past endDate.`
          );
        }
        await rt.save();
      }
    }
    console.log(`[MANUAL SYNC] Job finished at ${new Date().toISOString()}`);
  } catch (error) {
    console.error(
      `[MANUAL SYNC] Error processing recurring transactions:`,
      error
    );
  }
}
