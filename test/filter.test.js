import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, newUser, monthStart, istToday } from "./helpers.js";

let ctx, client;
before(async () => {
  ctx = await startServer();
  ({ client } = await newUser(ctx));
  // 30 transactions: every 10th is income
  for (let i = 0; i < 30; i++) {
    await client.post("/user/addTransaction", {
      type: i % 10 === 0 ? "income" : "expense",
      amount: 100 + i,
      category: "need",
      date: monthStart(),
      note: `item ${i}`,
    });
  }
});
after(async () => {
  await ctx.stop();
});

const expectedNet = [...Array(30).keys()].reduce(
  (s, i) => s + (i % 10 === 0 ? 1 : -1) * (100 + i),
  0
);

test("pages of 25 with totals for every match", async () => {
  const p1 = await client.get("/filter?limit=25&offset=0");
  assert.equal(p1.data.data.transactions.length, 25);
  assert.equal(p1.data.pagination.totalTransactions, 30);
  assert.equal(p1.data.pagination.net, expectedNet);
  assert.equal(p1.data.pagination.hasMore, true);

  const p2 = await client.get("/filter?limit=25&offset=25");
  assert.equal(p2.data.data.transactions.length, 5);
  assert.equal(p2.data.pagination.hasMore, false);
  const ids1 = new Set(p1.data.data.transactions.map((t) => t._id));
  assert.ok(
    !p2.data.data.transactions.some((t) => ids1.has(t._id)),
    "no row on both pages"
  );
});

test("amount sort works with paging", async () => {
  const r = await client.get("/filter?page=1&limit=10&sort=highestToLowest");
  const amounts = r.data.data.transactions.map((t) => t.amount);
  assert.equal(amounts[0], 129);
  assert.ok(amounts.every((a, i) => i === 0 || amounts[i - 1] >= a));
});

test("without page/limit everything matching is returned (old behaviour)", async () => {
  const r = await client.get("/filter?note=item%201");
  assert.equal(r.data.data.transactions.length, 11); // item 1, 10..19
  assert.equal(r.data.pagination.page, undefined);
});

test("bad paging values are a 400", async () => {
  assert.equal((await client.get("/filter?page=0&limit=500")).status, 400);
  assert.equal((await client.get("/filter?offset=-1")).status, 400);
});

test("an IST user's 'today' is not a future toDate", async () => {
  const r = await client.get(`/filter?toDate=${istToday()}`);
  assert.equal(r.status, 200);
});

test("search rejects regex characters", async () => {
  assert.equal((await client.get("/filter?note=.*")).status, 400);
});
