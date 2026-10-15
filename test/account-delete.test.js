import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { startServer, newUser, monthStart } from "./helpers.js";
import User from "../src/model/user.js";
import Transaction from "../src/model/transactions.js";
import RecurringTransaction from "../src/model/recurringTransaction.js";
import Goal from "../src/model/goal.js";
import Feedback from "../src/model/feedback.js";
import Session from "../src/model/session.js";

let ctx;
before(async () => {
  ctx = await startServer();
});
after(async () => {
  await ctx.stop();
});

const PNG = Buffer.concat([
  Buffer.from("89504e470d0a1a0a", "hex"),
  Buffer.alloc(40, 1),
]);

// Some of everything: a transaction with a receipt, a recurring rule, a
// goal, feedback, and a second signed-in device
async function fill(client, email, password) {
  const t = await client.post("/user/addTransaction", {
    type: "expense",
    amount: 300,
    category: "need",
    date: monthStart(),
    note: "Groceries",
    isRecurring: true,
    frequency: "monthly",
  });
  const receipt = await client.upload(
    `/user/transaction/${t.data.data._id}/receipt`,
    PNG
  );
  const goal = await client.post("/goal/create", {
    title: "Trip",
    targetAmount: 5000,
  });
  const fb = await client.post("/user/submitFeedback", {
    feedbackType: "feature",
    feedbackText: "Please add dark mode",
  });
  const other = ctx.client();
  const login = await other.post("/login", { email, password });
  // every piece really exists before we delete
  for (const r of [t, receipt, goal, fb, login])
    assert.ok(r.status < 300, `setup step failed: ${r.status}`);
  return { receiptKey: receipt.data.receipt.key, other };
}

test("delete account: everything goes, other accounts stay", async () => {
  const me = await newUser(ctx);
  const someoneElse = await newUser(ctx);
  await someoneElse.client.post("/user/addTransaction", {
    type: "expense",
    amount: 50,
    category: "want",
    date: monthStart(),
    note: "Coffee",
  });
  const { receiptKey, other } = await fill(me.client, me.email, me.password);
  const userId = (await User.findOne({ email: me.email }))._id;
  assert.equal(await Feedback.countDocuments({ UserId: userId }), 1);
  assert.equal(await Session.countDocuments({ userId }), 2);
  assert.ok(existsSync(path.join(process.env.RECEIPTS_DIR, receiptKey)));

  const r = await me.client.del("/user/account", { password: me.password });
  assert.equal(r.status, 200);

  assert.equal(await User.countDocuments({ _id: userId }), 0);
  for (const [model, field] of [
    [Transaction, "userId"],
    [RecurringTransaction, "userId"],
    [Goal, "userId"],
    [Feedback, "UserId"],
    [Session, "userId"],
  ]) {
    assert.equal(
      await model.countDocuments({ [field]: userId }),
      0,
      model.modelName
    );
  }
  assert.ok(!existsSync(path.join(process.env.RECEIPTS_DIR, String(userId))));

  // both devices are signed out, and the login no longer works
  assert.equal((await me.client.get("/me")).status, 401);
  assert.equal((await other.get("/me")).status, 401);
  const login = await ctx.client().post("/login", {
    email: me.email,
    password: me.password,
  });
  assert.equal(login.status, 401);

  // the other account is untouched
  const theirs = await someoneElse.client.get("/user/transactions");
  assert.equal(theirs.status, 200);
  assert.equal((await someoneElse.client.get("/me")).status, 200);
});

test("delete account needs the right password", async () => {
  const me = await newUser(ctx);
  assert.equal((await me.client.del("/user/account", {})).status, 400);
  const wrong = await me.client.del("/user/account", { password: "Nope1234@" });
  assert.equal(wrong.status, 403);
  assert.equal((await me.client.get("/me")).status, 200);
});
