import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, newUser, monthStart, utcToday } from "./helpers.js";
import User from "../src/model/user.js";
import Transaction from "../src/model/transactions.js";

let ctx;
before(async () => {
  ctx = await startServer();
});
after(async () => {
  await ctx.stop();
});

test("monthly summary keeps goal savings separate from spending", async () => {
  const { client } = await newUser(ctx);
  await client.post("/user/addTransaction", {
    type: "income",
    amount: 1000,
    category: "other",
    date: monthStart(),
    note: "",
  });
  await client.post("/user/addTransaction", {
    type: "expense",
    amount: 300,
    category: "need",
    date: monthStart(),
    note: "",
  });
  const goalId = (
    await client.post("/goal/create", { title: "Fund", targetAmount: 5000 })
  ).data.goal._id;
  await client.patch(`/goal/update/${goalId}`, { addAmount: 200 });

  const [y, m] = utcToday().split("-").map(Number);
  const r = await client.post("/insights/monthlySummary", { year: y });
  const month = r.data.summary.find((s) => s.monthNumber === m);
  assert.deepEqual(
    { income: month.income, expense: month.expense, savings: month.savings },
    { income: 1000, expense: 300, savings: 200 }
  );
});

test("anomaly detection rejects bad thresholds", async () => {
  const { client } = await newUser(ctx);
  const r = await client.post("/insights/anomalyDetection", {
    thresholdPercent: 500,
  });
  assert.equal(r.status, 400);
});

test("year compare only counts months both years have", async () => {
  const { client, email } = await newUser(ctx);
  const { _id: userId } = await User.findOne({ email });
  // The API only takes current-month dates, so past years go in directly
  const t = (type, amount, category, date) => ({
    userId,
    type,
    amount,
    category,
    date: new Date(`${date}T12:00:00Z`),
    note: "",
  });
  // 2024 has Jan + Feb; 2025 has only Feb (and a March with no partner)
  await Transaction.insertMany([
    t("expense", 1000, "need", "2024-01-10"),
    t("expense", 2000, "need", "2024-02-10"),
    t("expense", 500, "want", "2024-02-11"),
    t("income", 9000, "other", "2024-02-01"),
    t("expense", 3000, "need", "2025-02-10"),
    t("income", 10000, "other", "2025-02-01"),
    t("expense", 700, "want", "2025-03-05"),
  ]);

  const r = await client.get("/insights/compare?year=2025&against=2024");
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.period, [2]);
  assert.deepEqual(r.data.totals.current, {
    income: 10000,
    expense: 3000,
    savings: 0,
  });
  assert.deepEqual(r.data.totals.previous, {
    income: 9000,
    expense: 2500,
    savings: 0,
  });
  const cat = Object.fromEntries(
    r.data.categories.map((c) => [c.category, [c.current, c.previous]])
  );
  assert.deepEqual(cat.need, [3000, 2000]);
  assert.deepEqual(cat.want, [0, 500]);
  // every month is still there for the chart
  assert.equal(r.data.months.length, 12);
  assert.equal(r.data.months[0].previous.expense, 1000);
  assert.equal(r.data.months[2].current.expense, 700);

  // "against" defaults to the year before
  const d = await client.get("/insights/compare?year=2025");
  assert.equal(d.data.against, 2024);
});

test("year compare rejects bad or equal years", async () => {
  const { client } = await newUser(ctx);
  for (const q of ["year=abc", "year=2025&against=2025", "year=1800"]) {
    const r = await client.get(`/insights/compare?${q}`);
    assert.equal(r.status, 400, q);
  }
});
