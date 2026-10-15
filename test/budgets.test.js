import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, newUser, utcToday } from "./helpers.js";

let ctx;
before(async () => {
  ctx = await startServer();
});
after(async () => {
  await ctx.stop();
});

const spend = (client, amount, category) =>
  client.post("/user/addTransaction", {
    type: "expense",
    amount,
    category,
    date: utcToday(),
    note: "",
  });
const row = (r, category) => r.data.data.find((x) => x.category === category);

test("no budgets yet: every category is 'none'", async () => {
  const { client } = await newUser(ctx);
  const r = await client.get("/budgets");
  assert.equal(r.status, 200);
  assert.deepEqual(
    r.data.data.map((x) => x.level),
    ["none", "none", "none", "none"]
  );
});

test("set, change and clear budgets", async () => {
  const { client } = await newUser(ctx);
  let r = await client.put("/budgets", { need: 15000, want: "8000.5" });
  assert.equal(r.status, 200);
  assert.equal(row(r, "need").limit, 15000);
  assert.equal(row(r, "want").limit, 8000.5);
  r = await client.put("/budgets", { want: null });
  assert.equal(row(r, "want").limit, null);
  assert.equal(
    row(r, "need").limit,
    15000,
    "untouched categories keep their budget"
  );
});

test("bad budgets are refused", async () => {
  const { client } = await newUser(ctx);
  assert.equal((await client.put("/budgets", { want: -5 })).status, 400);
  assert.equal((await client.put("/budgets", { want: "lots" })).status, 400);
  assert.equal(
    (await client.put("/budgets", { goal: 100 })).status,
    400,
    "not a budget category"
  );
  assert.equal((await client.get("/budgets?month=13")).status, 400);
});

test("status: ok -> warning at 80% -> over at 100%; savings don't count", async () => {
  const { client } = await newUser(ctx);
  await client.put("/budgets", { want: 1000 });

  let r = await spend(client, 500, "want");
  assert.equal(r.data.budgetAlert, null, "50%: no alert");
  r = await spend(client, 350, "want");
  assert.equal(r.data.budgetAlert.level, "warning");
  assert.equal(r.data.budgetAlert.percent, 85);
  r = await spend(client, 200, "want");
  assert.equal(r.data.budgetAlert.level, "over");
  assert.equal(r.data.budgetAlert.percent, 105);

  const goalId = (
    await client.post("/goal/create", { title: "Trip", targetAmount: 5000 })
  ).data.goal._id;
  await client.patch(`/goal/update/${goalId}`, { addAmount: 1000 });
  const s = await client.get("/budgets");
  assert.equal(row(s, "want").spent, 1050, "goal savings excluded");

  const income = await client.post("/user/addTransaction", {
    type: "income",
    amount: 500,
    category: "want",
    date: utcToday(),
    note: "",
  });
  assert.equal(income.data.budgetAlert, null, "income never alerts");
});

test("other categories and other users are separate", async () => {
  const { client } = await newUser(ctx);
  await client.put("/budgets", { want: 100 });
  const r = await spend(client, 5000, "need");
  assert.equal(r.data.budgetAlert, null, "no budget on needs");
  const { client: other } = await newUser(ctx);
  assert.equal(row(await other.get("/budgets"), "want").limit, null);
});
