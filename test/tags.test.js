import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, newUser, utcToday } from "./helpers.js";
import Transaction from "../src/model/transactions.js";

let ctx, client;
before(async () => {
  ctx = await startServer();
  ({ client } = await newUser(ctx));
});
after(async () => {
  await ctx.stop();
});

const add = async (note) =>
  (
    await client.post("/user/addTransaction", {
      type: "expense",
      amount: 100,
      category: "want",
      date: utcToday(),
      note,
    })
  ).data.data._id;
const setTags = (id, tags, c = client) =>
  c.patch(`/user/transaction/${id}/tags`, { tags });

test("set tags: trimmed, lower-cased, de-duplicated", async () => {
  const id = await add("Dinner");
  const r = await setTags(id, ["  Food ", "food", "Eating  Out", "Diwali"]);
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.data.tags, ["food", "eating out", "diwali"]);
  assert.deepEqual((await setTags(id, [])).data.data.tags, [], "can clear");
});

test("tags in Hindi work (vowel signs are Unicode marks)", async () => {
  const id = await add("Festival");
  const r = await setTags(id, ["दिवाली", "मिठाई"]);
  assert.equal(r.status, 200, r.data.message);
  assert.deepEqual(r.data.data.tags, ["दिवाली", "मिठाई"]);
});

test("invalid tags are refused", async () => {
  const id = await add("Cab");
  for (const tags of [
    "food",
    ["x".repeat(21)],
    ["<script>"],
    ["-dash-first"],
    Array.from({ length: 11 }, (_, i) => `t${i}`),
  ]) {
    assert.equal(
      (await setTags(id, tags)).status,
      400,
      JSON.stringify(tags).slice(0, 40)
    );
  }
});

test("tags can be changed on past months (labels, not money)", async () => {
  const id = await add("Old");
  await Transaction.updateOne({ _id: id }, { date: new Date("2026-01-05") });
  assert.equal((await setTags(id, ["archive"])).status, 200);
});

test("only the owner can tag a transaction", async () => {
  const id = await add("Mine");
  const { client: other } = await newUser(ctx);
  assert.equal((await setTags(id, ["hack"], other)).status, 404);
});

test("filter by one tag, or by several (must carry all)", async () => {
  const a = await add("Pizza");
  const b = await add("Train");
  const c = await add("Hotel");
  await setTags(a, ["food", "weekend"]);
  await setTags(b, ["travel"]);
  await setTags(c, ["travel", "weekend"]);

  const notes = async (q) =>
    (await client.get(`/filter?${q}`)).data.data.transactions
      .map((t) => t.note)
      .sort();
  assert.deepEqual(await notes("tag=travel"), ["Hotel", "Train"]);
  assert.deepEqual(
    await notes("tag=Weekend"),
    ["Hotel", "Pizza"],
    "case-insensitive"
  );
  assert.deepEqual(await notes("tag=travel,weekend"), ["Hotel"]);
  assert.deepEqual(
    await notes("tag=travel&note=Train"),
    ["Train"],
    "with other filters"
  );
  assert.equal((await client.get("/filter?tag=%3Cscript%3E")).status, 400);
});

test("the tag list is distinct and A-Z", async () => {
  const { client: fresh } = await newUser(ctx);
  const add2 = async (note) =>
    (
      await fresh.post("/user/addTransaction", {
        type: "expense",
        amount: 1,
        category: "want",
        date: utcToday(),
        note,
      })
    ).data.data._id;
  await setTags(await add2("a"), ["zoo", "apple"], fresh);
  await setTags(await add2("b"), ["apple", "mango"], fresh);
  const r = await fresh.get("/allTags");
  assert.deepEqual(r.data.data, ["apple", "mango", "zoo"]);
});
