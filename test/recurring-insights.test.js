import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, newUser, monthStart, utcToday } from "./helpers.js";
import { upcomingDates, priceChange } from "../src/utils/recurringInsights.js";

let ctx;
before(async () => {
  ctx = await startServer();
});
after(async () => {
  await ctx.stop();
});

const d = (s) => new Date(`${s}T00:00:00.000Z`);
const iso = (dates) => dates.map((x) => x.toISOString().slice(0, 10));

test("upcoming dates respect skips, end dates and what's already created", () => {
  const today = d("2026-03-10");
  const until = d("2026-04-30");
  const rule = {
    frequency: "monthly",
    startDate: d("2026-01-15"),
    lastOccurrence: d("2026-02-15"),
    skipDates: [],
  };
  assert.deepEqual(iso(upcomingDates(rule, today, until)), [
    "2026-03-15",
    "2026-04-15",
  ]);
  assert.deepEqual(
    iso(upcomingDates({ ...rule, skipDates: [d("2026-03-15")] }, today, until)),
    ["2026-04-15"]
  );
  assert.deepEqual(
    iso(upcomingDates({ ...rule, endDate: d("2026-04-01") }, today, until)),
    ["2026-03-15"]
  );
  // a payment due today that was already created isn't listed again
  const weekly = {
    frequency: "weekly",
    startDate: d("2026-03-03"),
    lastOccurrence: d("2026-03-10"),
  };
  assert.deepEqual(iso(upcomingDates(weekly, today, d("2026-03-24"))), [
    "2026-03-17",
    "2026-03-24",
  ]);
});

test("price changes: recent change, edited amount, old news", () => {
  const now = d("2026-10-15");
  const rule = { amount: 649, isActive: true, nextOccurrence: d("2026-11-07") };
  const payments = [
    { amount: 649, date: d("2026-10-07") },
    { amount: 649, date: d("2026-09-07") },
    { amount: 499, date: d("2026-08-07") },
  ];
  assert.deepEqual(priceChange(rule, payments, now), {
    kind: "changed",
    from: 499,
    to: 649,
    date: d("2026-09-07"),
    percent: 30.06,
  });
  // the user edited the amount: the next payment will differ
  const edited = priceChange({ ...rule, amount: 799 }, payments, now);
  assert.equal(edited.kind, "upcoming");
  assert.deepEqual([edited.from, edited.to], [649, 799]);
  // a change more than 90 days ago isn't news any more
  assert.equal(priceChange(rule, payments, d("2027-01-15")), null);
  // a steady price and no history: nothing to say
  assert.equal(priceChange(rule, payments.slice(0, 2), now), null);
  assert.equal(priceChange(rule, [], now), null);
});

test("GET /recurring/insights: committed, next 30 days, edited amount", async () => {
  const { client } = await newUser(ctx);
  const r = await client.post("/user/addTransaction", {
    type: "expense",
    amount: 600,
    category: "need",
    date: monthStart(),
    note: "Gym",
    isRecurring: true,
    frequency: "weekly",
  });
  const ruleId = r.data.recurring._id;
  await client.post("/sync");

  let ins = (await client.get("/recurring/insights")).data;
  assert.deepEqual(ins.committed, {
    expense: 2600, // 600 × 52 / 12
    income: 0,
    active: 1,
    total: 1,
  });
  const today = utcToday();
  const last = new Date(Date.parse(today) + 30 * 86400e3)
    .toISOString()
    .slice(0, 10);
  const days = ins.upcoming.items.map((u) => u.date.slice(0, 10));
  assert.ok(days.length >= 4 && days.length <= 5, days.join());
  assert.ok(days.every((x) => x >= today && x <= last));
  assert.equal(ins.upcoming.expense, 600 * days.length);
  assert.deepEqual(ins.priceChanges, []);

  await client.patch(`/recurring/transaction/${ruleId}`, { amount: 750 });
  ins = (await client.get("/recurring/insights")).data;
  assert.equal(ins.priceChanges.length, 1);
  assert.equal(ins.priceChanges[0].kind, "upcoming");
  assert.deepEqual(
    [
      ins.priceChanges[0].from,
      ins.priceChanges[0].to,
      ins.priceChanges[0].note,
    ],
    [600, 750, "Gym"]
  );

  // paused rules don't count as committed or upcoming
  await client.post(`/recurring/pauseTransaction/${ruleId}`);
  ins = (await client.get("/recurring/insights")).data;
  assert.equal(ins.committed.expense, 0);
  assert.equal(ins.upcoming.count, 0);
});
