import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, newUser, monthStart, utcToday } from "./helpers.js";
import { occurrencesBetween, nextOccurrenceAfter } from "../src/utils/dates.js";

let ctx;
before(async () => { ctx = await startServer(); });
after(async () => { await ctx.stop(); });

const iso = (dates) => dates.map((d) => d.toISOString().slice(0, 10));

test("monthly rules stay on month-end (no drift after February)", () => {
  const dates = occurrencesBetween("monthly", "2026-01-31", "2026-01-31", "2026-06-30");
  assert.deepEqual(iso(dates), ["2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31", "2026-06-30"]);
});

test("next occurrence accepts strings (used to loop forever)", () => {
  assert.equal(nextOccurrenceAfter("daily", "2026-10-01", "2026-10-01").toISOString().slice(0, 10), "2026-10-02");
  assert.deepEqual(occurrencesBetween("daily", "nope", "x", "y"), []);
});

test("a minutely rule from years ago resolves instantly", () => {
  const t0 = Date.now();
  const next = nextOccurrenceAfter("minutely", new Date("2020-01-01"), new Date());
  assert.ok(next > new Date());
  assert.ok(Date.now() - t0 < 500);
});

test("daily rule: parallel syncs create each missed day exactly once", async () => {
  const { client } = await newUser(ctx);
  const r = await client.post("/user/addTransaction", { type: "expense", amount: 50, category: "want", date: monthStart(), note: "", isRecurring: true, frequency: "daily" });
  assert.equal(r.status, 201);
  const ruleId = r.data.recurring._id;
  assert.equal(r.data.data.recurringTransactionId, ruleId, "first transaction linked to its rule");

  const expected = Number(utcToday().slice(8, 10)) - 1; // the 2nd .. today
  const [a, b] = await Promise.all([client.post("/sync"), client.post("/sync")]);
  assert.equal(a.data.created + b.data.created, expected);
  assert.equal((await client.post("/sync")).data.created, 0, "third sync adds nothing");

  const list = await client.get("/user/transactions");
  const days = list.data.data.transactions.filter((t) => t.recurringTransactionId === ruleId).map((t) => t.date.slice(0, 10));
  assert.equal(days.length, expected + 1);
  assert.equal(new Set(days).size, days.length, "no day twice");
});

test("editing the first transaction updates the series; pause/resume skips the gap; deleting stops it", async () => {
  const { client } = await newUser(ctx);
  const r = await client.post("/user/addTransaction", { type: "expense", amount: 50, category: "want", date: monthStart(), note: "", isRecurring: true, frequency: "daily" });
  const parentId = r.data.data._id;
  const ruleId = r.data.recurring._id;

  await client.patch(`/user/update/transaction/${parentId}`, { type: "expense", amount: 75, category: "want", date: monthStart(), note: "Coffee" });
  let rule = (await client.get("/recurring/transactions")).data.data.find((x) => x._id === ruleId);
  assert.equal(rule.amount, 75);
  assert.equal(rule.note, "Coffee");

  assert.equal((await client.post(`/recurring/pauseTransaction/${ruleId}`)).status, 200);
  const resumed = await client.post(`/recurring/resumeTransaction/${ruleId}`);
  assert.equal(resumed.status, 200);
  assert.ok(new Date(resumed.data.data.nextOccurrence) > new Date(), "resumes in the future");
  assert.equal((await client.post("/sync")).data.created, 0, "no back-fill of the paused days");

  assert.equal((await client.del(`/user/transaction/delete/${parentId}`)).status, 200);
  rule = (await client.get("/recurring/transactions")).data.data.find((x) => x._id === ruleId);
  assert.ok(rule, "still listed so the user can see it");
  assert.equal(rule.isActive, false);
});

test("sync only touches the signed-in user's rules", async () => {
  const { client: a } = await newUser(ctx);
  const { client: b } = await newUser(ctx);
  await a.post("/user/addTransaction", { type: "expense", amount: 10, category: "need", date: monthStart(), note: "", isRecurring: true, frequency: "daily" });
  const synced = await b.post("/sync");
  assert.equal(synced.data.created, 0);
  assert.deepEqual((await b.get("/recurring-transactions")).data, []);
});
