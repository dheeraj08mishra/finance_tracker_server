import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, newUser, utcToday, monthStart } from "./helpers.js";
import Transaction from "../src/model/transactions.js";
import RecurringTransaction from "../src/model/recurringTransaction.js";
import {
  sendMonthlySummaries,
  sendTomorrowReminders,
} from "../src/utils/notifications.js";

let ctx;
before(async () => {
  ctx = await startServer();
});
after(async () => {
  await ctx.stop();
});

// Emails are logged locally; collect the ones sent while `fn` runs
async function emailsDuring(fn) {
  const lines = [];
  const original = console.log;
  console.log = (...a) => lines.push(a.join(" "));
  try {
    await fn();
  } finally {
    console.log = original;
  }
  return lines
    .filter((l) => l.startsWith("[EMAIL]"))
    .map((l) => ({
      to: l.match(/to=(\S+)/)[1],
      subject: l.match(/subject="([^"]*)"/)[1],
      body: l,
    }));
}
const spend = (client, amount, category = "want", date = utcToday()) =>
  client.post("/user/addTransaction", {
    type: "expense",
    amount,
    category,
    date,
    note: "",
  });

test("email settings: on by default, can be switched off, validated", async () => {
  const { client } = await newUser(ctx);
  assert.deepEqual((await client.get("/me")).data.user.notifications, {
    budgetAlerts: true,
    monthlySummary: true,
    recurringReminders: true,
  });
  const r = await client.patch("/user/notifications", {
    monthlySummary: false,
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.notifications.monthlySummary, false);
  assert.equal(r.data.notifications.budgetAlerts, true);
  assert.equal(
    (await client.patch("/user/notifications", { monthlySummary: "no" }))
      .status,
    400
  );
  assert.equal(
    (await client.patch("/user/notifications", { spam: true })).status,
    400
  );
  assert.equal((await client.patch("/user/notifications", {})).status, 400);
});

test("budget alert emails: once at 80%, once when over, never repeated", async () => {
  const { client, email } = await newUser(ctx);
  await client.put("/budgets", { want: 1000 });

  let mails = await emailsDuring(() => spend(client, 500));
  assert.equal(mails.length, 0, "50%: nothing");

  mails = await emailsDuring(() => spend(client, 350));
  assert.equal(mails.length, 1);
  assert.equal(mails[0].to, email);
  assert.match(mails[0].subject, /used 85% of your Wants budget/);

  mails = await emailsDuring(() => spend(client, 50));
  assert.equal(mails.length, 0, "still a warning: not emailed again");

  mails = await emailsDuring(() => spend(client, 200));
  assert.equal(mails.length, 1);
  assert.match(mails[0].subject, /over your Wants budget/);

  mails = await emailsDuring(() => spend(client, 100));
  assert.equal(mails.length, 0, "already told it's over");
});

test("parallel expenses can't send the same alert twice", async () => {
  const { client } = await newUser(ctx);
  await client.put("/budgets", { want: 1000 });
  const mails = await emailsDuring(() =>
    Promise.all([spend(client, 450), spend(client, 450)])
  );
  assert.equal(mails.length, 1);
});

test("no budget emails when switched off (the in-app warning stays)", async () => {
  const { client } = await newUser(ctx);
  await client.put("/budgets", { want: 100 });
  await client.patch("/user/notifications", { budgetAlerts: false });
  let r;
  const mails = await emailsDuring(async () => {
    r = await spend(client, 500);
  });
  assert.equal(mails.length, 0);
  assert.equal(r.data.budgetAlert.level, "over", "the app still warns");
});

test("recurring payments that create expenses can trigger the alert", async () => {
  const { client, email } = await newUser(ctx);
  await client.put("/budgets", { want: 100 });
  const me = (await client.get("/me")).data.user._id;
  await RecurringTransaction.create({
    userId: me,
    type: "expense",
    amount: 90,
    category: "want",
    note: "Streaming",
    frequency: "daily",
    startDate: new Date(Date.now() - 2 * 86400e3).toISOString().slice(0, 10),
    nextOccurrence: new Date(Date.now() - 1 * 86400e3)
      .toISOString()
      .slice(0, 10),
    isActive: true,
    createdBy: me,
  });
  const mails = await emailsDuring(() => client.post("/sync"));
  // the two created days may fall in different months at a month boundary
  assert.ok(
    mails.some((m) => m.to === email && /Wants budget/.test(m.subject))
  );
});

test("monthly summary: users with activity who want it", async () => {
  const { client: a, email: emailA } = await newUser(ctx);
  const { client: b } = await newUser(ctx);
  const { client: c } = await newUser(ctx); // no activity
  await b.patch("/user/notifications", { monthlySummary: false });
  const meA = (await a.get("/me")).data.user._id;
  const meB = (await b.get("/me")).data.user._id;
  void c;

  // a past month, written directly (the app only adds to the current one)
  const tx = (userId, type, amount, category, day) => ({
    userId,
    type,
    amount,
    category,
    date: `2026-03-${day}`,
    note: "",
  });
  await Transaction.insertMany([
    tx(meA, "income", 50000, "other", "01"),
    tx(meA, "expense", 12000, "need", "05"),
    tx(meA, "expense", 3000, "want", "09"),
    tx(meA, "expense", 5000, "goal", "10"),
    tx(meB, "expense", 999, "need", "11"),
  ]);

  let result;
  const mails = await emailsDuring(async () => {
    result = await sendMonthlySummaries(2026, 3);
  });
  const mine = mails.filter((m) => m.to === emailA);
  assert.equal(mine.length, 1);
  assert.match(
    mine[0].subject,
    /March 2026 summary: ₹15,000 spent, ₹5,000 saved/
  );
  assert.match(mine[0].body, /Income: ₹50,000/);
  assert.match(mine[0].body, /Needs: ₹12,000/);
  assert.ok(
    !mails.some((m) => m.to !== emailA),
    "B opted out, C had no activity"
  );
  assert.ok(result.skipped >= 1);
});

test("payment reminders respect the setting", async () => {
  const { client, email } = await newUser(ctx);
  const me = (await client.get("/me")).data.user._id;
  const tomorrow = new Date(Date.now() + 86400e3).toISOString().slice(0, 10);
  await RecurringTransaction.create({
    userId: me,
    type: "expense",
    amount: 499,
    category: "want",
    note: "Gym",
    frequency: "monthly",
    startDate: monthStart(),
    nextOccurrence: tomorrow,
    isActive: true,
    createdBy: me,
  });
  let mails = await emailsDuring(() => sendTomorrowReminders());
  assert.ok(
    mails.some((m) => m.to === email && /Gym .*due tomorrow/.test(m.subject))
  );

  await client.patch("/user/notifications", { recurringReminders: false });
  mails = await emailsDuring(() => sendTomorrowReminders());
  assert.ok(!mails.some((m) => m.to === email));
});

test("emails escape what users typed", async () => {
  const { escapeHtml } = await import("../src/utils/autoEmail/mailer.js");
  assert.equal(
    escapeHtml('<img src=x onerror="alert(1)">'),
    "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;"
  );
});
