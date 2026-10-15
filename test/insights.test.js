import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, newUser, monthStart, utcToday } from "./helpers.js";

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
