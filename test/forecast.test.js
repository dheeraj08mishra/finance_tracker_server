import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, newUser } from "./helpers.js";
import Transaction from "../src/model/transactions.js";
import RecurringTransaction from "../src/model/recurringTransaction.js";
import { monthForecast } from "../src/utils/forecast.js";

let ctx;
before(async () => {
  ctx = await startServer();
});
after(async () => {
  await ctx.stop();
});

test("month-end forecast, worked out by hand for 10 June", async () => {
  const { client } = await newUser(ctx);
  const userId = (await client.get("/me")).data.user._id;
  const tx = (date, type, amount, category, isRecurring = false) => ({
    userId,
    date,
    type,
    amount,
    category,
    isRecurring,
    note: "",
  });
  await Transaction.insertMany([
    tx("2026-06-01", "income", 60000, "other"),
    tx("2026-06-02", "expense", 20000, "need", true), // rent: recurring
    tx("2026-06-03", "expense", 1000, "want"),
    tx("2026-06-05", "expense", 3000, "goal"), // savings, not spending
    tx("2026-06-08", "expense", 1500, "need"),
    tx("2026-05-28", "expense", 9999, "want"), // last month: ignored
  ]);
  const rule = (o) =>
    RecurringTransaction.create({
      userId,
      createdBy: userId,
      isActive: true,
      category: "need",
      note: "",
      ...o,
    });
  await rule({
    note: "Rent",
    type: "expense",
    amount: 20000,
    frequency: "monthly",
    startDate: "2026-05-02",
    lastOccurrence: "2026-06-02",
  });
  await rule({
    note: "Netflix",
    type: "expense",
    amount: 649,
    frequency: "monthly",
    startDate: "2026-05-15",
    lastOccurrence: "2026-05-15",
  });
  await rule({
    note: "Cleaner",
    type: "expense",
    amount: 500,
    frequency: "weekly",
    startDate: "2026-06-01",
    lastOccurrence: "2026-06-08",
    skipDates: ["2026-06-22"],
  });
  await rule({
    note: "Course",
    type: "expense",
    amount: 300,
    frequency: "weekly",
    startDate: "2026-06-02",
    lastOccurrence: "2026-06-09",
    endDate: "2026-06-16",
  });
  await rule({
    note: "Freelance",
    type: "income",
    amount: 5000,
    frequency: "monthly",
    startDate: "2026-05-25",
    lastOccurrence: "2026-05-25",
  });
  await rule({
    note: "Paused",
    type: "expense",
    amount: 99999,
    frequency: "daily",
    startDate: "2026-06-01",
    isActive: false,
  });

  const f = await monthForecast(userId, new Date("2026-06-10T12:00:00Z"));
  assert.equal(f.daysElapsed, 10);
  assert.equal(f.daysLeft, 20);
  assert.equal(f.spent, 22500);
  assert.equal(f.saved, 3000);
  assert.equal(f.dailyPace, 250, "only non-recurring spending sets the pace");
  assert.equal(f.projectedVariable, 5000);
  assert.deepEqual(
    f.upcoming.map((u) => `${u.date} ${u.note}`),
    [
      "2026-06-15 Netflix",
      "2026-06-15 Cleaner",
      "2026-06-16 Course",
      "2026-06-25 Freelance",
      "2026-06-29 Cleaner",
    ],
    "skip on the 22nd and the end date are respected"
  );
  assert.equal(f.upcomingExpenses, 649 + 500 + 300 + 500);
  assert.equal(f.upcomingIncome, 5000);
  assert.equal(f.projectedLeft, 65000 - (22500 + 5000 + 1949) - 3000);
  assert.equal(f.roughEstimate, false);
});

test("early in the month the forecast is flagged as rough", async () => {
  const { client } = await newUser(ctx);
  const userId = (await client.get("/me")).data.user._id;
  const f = await monthForecast(userId, new Date("2026-06-02T08:00:00Z"));
  assert.equal(f.roughEstimate, true);
  assert.equal(f.projectedLeft, 0, "nothing recorded yet");
});

test("GET /insights/forecast needs a session and returns the current month", async () => {
  assert.equal((await ctx.client().get("/insights/forecast")).status, 401);
  const { client } = await newUser(ctx);
  const r = await client.get("/insights/forecast");
  assert.equal(r.status, 200);
  assert.equal(r.data.month, new Date().getUTCMonth() + 1);
});
