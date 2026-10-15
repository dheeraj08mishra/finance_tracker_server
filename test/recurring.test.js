import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  startServer,
  newUser,
  monthStart,
  utcToday,
  daysFromUtcToday,
} from "./helpers.js";
import RecurringTransaction from "../src/model/recurringTransaction.js";
import { occurrencesBetween, nextOccurrenceAfter } from "../src/utils/dates.js";

let ctx;
before(async () => {
  ctx = await startServer();
});
after(async () => {
  await ctx.stop();
});

const iso = (dates) => dates.map((d) => d.toISOString().slice(0, 10));

test("monthly rules stay on month-end (no drift after February)", () => {
  const dates = occurrencesBetween(
    "monthly",
    "2026-01-31",
    "2026-01-31",
    "2026-06-30"
  );
  assert.deepEqual(iso(dates), [
    "2026-02-28",
    "2026-03-31",
    "2026-04-30",
    "2026-05-31",
    "2026-06-30",
  ]);
});

test("next occurrence accepts strings (used to loop forever)", () => {
  assert.equal(
    nextOccurrenceAfter("daily", "2026-10-01", "2026-10-01")
      .toISOString()
      .slice(0, 10),
    "2026-10-02"
  );
  assert.deepEqual(occurrencesBetween("daily", "nope", "x", "y"), []);
});

test("a minutely rule from years ago resolves instantly", () => {
  const t0 = Date.now();
  const next = nextOccurrenceAfter(
    "minutely",
    new Date("2020-01-01"),
    new Date()
  );
  assert.ok(next > new Date());
  assert.ok(Date.now() - t0 < 500);
});

test("daily rule: parallel syncs create each missed day exactly once", async () => {
  const { client } = await newUser(ctx);
  const r = await client.post("/user/addTransaction", {
    type: "expense",
    amount: 50,
    category: "want",
    date: monthStart(),
    note: "",
    isRecurring: true,
    frequency: "daily",
  });
  assert.equal(r.status, 201);
  const ruleId = r.data.recurring._id;
  assert.equal(
    r.data.data.recurringTransactionId,
    ruleId,
    "first transaction linked to its rule"
  );

  const expected = Number(utcToday().slice(8, 10)) - 1; // the 2nd .. today
  const [a, b] = await Promise.all([
    client.post("/sync"),
    client.post("/sync"),
  ]);
  assert.equal(a.data.created + b.data.created, expected);
  assert.equal(
    (await client.post("/sync")).data.created,
    0,
    "third sync adds nothing"
  );

  const list = await client.get("/user/transactions");
  const days = list.data.data.transactions
    .filter((t) => t.recurringTransactionId === ruleId)
    .map((t) => t.date.slice(0, 10));
  assert.equal(days.length, expected + 1);
  assert.equal(new Set(days).size, days.length, "no day twice");
});

test("editing the first transaction updates the series; pause/resume skips the gap; deleting stops it", async () => {
  const { client } = await newUser(ctx);
  const r = await client.post("/user/addTransaction", {
    type: "expense",
    amount: 50,
    category: "want",
    date: monthStart(),
    note: "",
    isRecurring: true,
    frequency: "daily",
  });
  const parentId = r.data.data._id;
  const ruleId = r.data.recurring._id;

  await client.patch(`/user/update/transaction/${parentId}`, {
    type: "expense",
    amount: 75,
    category: "want",
    date: monthStart(),
    note: "Coffee",
  });
  let rule = (await client.get("/recurring/transactions")).data.data.find(
    (x) => x._id === ruleId
  );
  assert.equal(rule.amount, 75);
  assert.equal(rule.note, "Coffee");

  assert.equal(
    (await client.post(`/recurring/pauseTransaction/${ruleId}`)).status,
    200
  );
  const resumed = await client.post(`/recurring/resumeTransaction/${ruleId}`);
  assert.equal(resumed.status, 200);
  assert.ok(
    new Date(resumed.data.data.nextOccurrence) > new Date(),
    "resumes in the future"
  );
  assert.equal(
    (await client.post("/sync")).data.created,
    0,
    "no back-fill of the paused days"
  );

  assert.equal(
    (await client.del(`/user/transaction/delete/${parentId}`)).status,
    200
  );
  rule = (await client.get("/recurring/transactions")).data.data.find(
    (x) => x._id === ruleId
  );
  assert.ok(rule, "still listed so the user can see it");
  assert.equal(rule.isActive, false);
});

test("sync only touches the signed-in user's rules", async () => {
  const { client: a } = await newUser(ctx);
  const { client: b } = await newUser(ctx);
  await a.post("/user/addTransaction", {
    type: "expense",
    amount: 10,
    category: "need",
    date: monthStart(),
    note: "",
    isRecurring: true,
    frequency: "daily",
  });
  const synced = await b.post("/sync");
  assert.equal(synced.data.created, 0);
  assert.deepEqual((await b.get("/recurring-transactions")).data, []);
});

// ---------- Part 1: more frequencies, edit, skip, delete ----------

const addRecurring = (client, body) =>
  client.post("/user/addTransaction", {
    type: "expense",
    amount: 100,
    category: "need",
    date: monthStart(),
    note: "",
    isRecurring: true,
    frequency: "monthly",
    ...body,
  });
const ruleOf = async (client, id) =>
  (await client.get("/recurring/transactions?limit=100")).data.data.find(
    (r) => r._id === id
  );

test("every 2 weeks, quarterly and every 6 months", () => {
  const two = occurrencesBetween(
    "biweekly",
    "2026-01-01",
    "2026-01-01",
    "2026-02-12"
  );
  assert.deepEqual(iso(two), ["2026-01-15", "2026-01-29", "2026-02-12"]);
  const q = occurrencesBetween(
    "quarterly",
    "2026-01-31",
    "2026-01-31",
    "2026-12-31"
  );
  assert.deepEqual(iso(q), ["2026-04-30", "2026-07-31", "2026-10-31"]);
  const h = occurrencesBetween(
    "halfyearly",
    "2026-03-15",
    "2026-03-15",
    "2027-12-31"
  );
  assert.deepEqual(iso(h), ["2026-09-15", "2027-03-15", "2027-09-15"]);
});

test("the new frequencies can be chosen when adding", async () => {
  const { client } = await newUser(ctx);
  for (const frequency of ["biweekly", "quarterly", "halfyearly"]) {
    const r = await addRecurring(client, { frequency });
    assert.equal(r.status, 201, frequency);
    assert.equal(r.data.recurring.frequency, frequency);
  }
});

test("edit amount and note: future only, the first transaction is untouched", async () => {
  const { client } = await newUser(ctx);
  const r = await addRecurring(client, { amount: 500, note: "Gym" });
  const id = r.data.recurring._id;
  const edited = await client.patch(`/recurring/transaction/${id}`, {
    amount: 650,
    note: "Gym plus",
  });
  assert.equal(edited.status, 200);
  assert.equal(edited.data.data.amount, 650);
  assert.equal(edited.data.data.note, "Gym plus");
  const first = await client.get(`/user/transactions/${r.data.data._id}`);
  assert.equal(first.data.data.amount, 500, "past transaction kept as it was");
});

test("changing frequency continues from today without back-filling", async () => {
  const { client } = await newUser(ctx);
  const r = await addRecurring(client, { frequency: "monthly" });
  const id = r.data.recurring._id;
  const edited = await client.patch(`/recurring/transaction/${id}`, {
    frequency: "daily",
  });
  assert.equal(edited.status, 200);
  assert.ok(
    new Date(edited.data.data.nextOccurrence) > new Date(),
    "next is in the future"
  );
  assert.equal(
    (await client.post("/sync")).data.created,
    0,
    "no daily back-fill"
  );
});

test("edit validation: bad frequency, amount or end date", async () => {
  const { client } = await newUser(ctx);
  const id = (await addRecurring(client, {})).data.recurring._id;
  const bad = async (body) =>
    (await client.patch(`/recurring/transaction/${id}`, body)).status;
  assert.equal(await bad({ frequency: "minutely" }), 400);
  assert.equal(await bad({ amount: -1 }), 400);
  assert.equal(await bad({ endDate: "2020-01-01" }), 400, "before the start");
  assert.equal(await bad({ endDate: "not a date" }), 400);
  assert.equal(await bad({ category: "nonsense" }), 400, "schema enum");
});

test("an end date on or before the next payment ends the series", async () => {
  const { client } = await newUser(ctx);
  const id = (await addRecurring(client, { frequency: "monthly" })).data
    .recurring._id;
  const r = await client.patch(`/recurring/transaction/${id}`, {
    endDate: monthStart(),
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.data.isActive, false);
  assert.equal(r.data.data.nextOccurrence, null);
  const cleared = await client.patch(`/recurring/transaction/${id}`, {
    endDate: null,
  });
  assert.equal(cleared.data.data.endDate, null);
});

test("skip next: that day is never created, the series continues", async () => {
  const { client } = await newUser(ctx);
  const me = (await client.get("/me")).data.user._id;
  // A daily rule that started 5 days ago and hasn't run yet
  const start = daysFromUtcToday(-5);
  const rule = await RecurringTransaction.create({
    userId: me,
    type: "expense",
    amount: 20,
    category: "want",
    note: "",
    frequency: "daily",
    startDate: start,
    nextOccurrence: daysFromUtcToday(-4),
    isActive: true,
    createdBy: me,
  });
  const id = String(rule._id);

  const skip = await client.post(`/recurring/skipTransaction/${id}`);
  assert.equal(skip.status, 200);
  assert.equal(skip.data.skipped.slice(0, 10), daysFromUtcToday(-4));
  assert.equal(
    skip.data.data.nextOccurrence.slice(0, 10),
    daysFromUtcToday(-3)
  );

  const synced = await client.post("/sync");
  assert.equal(synced.data.created, 4, "-3, -2, -1 and today");
  const days = (await client.get("/user/transactions")).data.data.transactions
    .filter((t) => t.recurringTransactionId === id)
    .map((t) => t.date.slice(0, 10));
  assert.ok(!days.includes(daysFromUtcToday(-4)), "skipped day not created");
  const after = await ruleOf(client, id);
  assert.ok(new Date(after.nextOccurrence) > new Date());
  assert.equal(after.skipDates.length, 0, "old skips cleaned up");
});

test("skip needs an upcoming payment", async () => {
  const { client } = await newUser(ctx);
  const id = (await addRecurring(client, {})).data.recurring._id;
  await client.post(`/recurring/pauseTransaction/${id}`);
  assert.equal(
    (await client.post(`/recurring/skipTransaction/${id}`)).status,
    400
  );
});

test("delete a series: past transactions stay; only the owner can delete", async () => {
  const { client } = await newUser(ctx);
  const r = await addRecurring(client, { note: "Netflix" });
  const id = r.data.recurring._id;
  const { client: other } = await newUser(ctx);
  assert.equal((await other.del(`/recurring/transaction/${id}`)).status, 404);
  assert.equal(
    (await other.patch(`/recurring/transaction/${id}`, { amount: 1 })).status,
    404
  );
  assert.equal((await client.del(`/recurring/transaction/${id}`)).status, 200);
  assert.equal(await ruleOf(client, id), undefined);
  const first = await client.get(`/user/transactions/${r.data.data._id}`);
  assert.equal(first.status, 200, "the transaction it created is kept");
});
