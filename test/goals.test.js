import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, newUser } from "./helpers.js";

let ctx;
before(async () => { ctx = await startServer(); });
after(async () => { await ctx.stop(); });

test("contributions are capped at the target and tracked as goal transactions", async () => {
  const { client } = await newUser(ctx);
  const goalId = (await client.post("/goal/create", { title: "Bike", targetAmount: 1000 })).data.goal._id;

  let r = await client.patch(`/goal/update/${goalId}`, { addAmount: 700 });
  assert.equal(r.data.goal.currentAmount, 700);

  r = await client.patch(`/goal/update/${goalId}`, { addAmount: 500 });
  assert.equal(r.status, 200);
  assert.equal(r.data.goal.currentAmount, 1000);
  assert.equal(r.data.contribution, 300);
  assert.equal(r.data.goal.isCompleted, true);

  r = await client.patch(`/goal/update/${goalId}`, { addAmount: 10 });
  assert.equal(r.status, 400, "completed goal takes no more");

  const txns = (await client.get("/user/transactions")).data.data.transactions;
  const capped = txns.find((t) => t.goalId === goalId && t.amount === 300);
  assert.equal(capped.category, "goal");

  await client.del(`/user/transaction/delete/${capped._id}`);
  const goal = (await client.get("/goal/list")).data.goals.find((g) => g._id === goalId);
  assert.equal(goal.currentAmount, 700, "deleting a contribution lowers the goal");
  assert.equal(goal.isCompleted, false);
});

test("bad contribution amounts are rejected", async () => {
  const { client } = await newUser(ctx);
  const goalId = (await client.post("/goal/create", { title: "Trip", targetAmount: 500 })).data.goal._id;
  for (const addAmount of [0, -10, "100", null]) {
    assert.equal((await client.patch(`/goal/update/${goalId}`, { addAmount })).status, 400, String(addAmount));
  }
});
