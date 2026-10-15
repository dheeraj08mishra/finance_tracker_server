import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import {
  startServer,
  newUser,
  istToday,
  daysFromUtcToday,
  utcToday,
} from "./helpers.js";

let ctx, client;
before(async () => {
  ctx = await startServer();
  ({ client } = await newUser(ctx));
});
after(async () => {
  await ctx.stop();
});

const add = (body) =>
  client.post("/user/addTransaction", {
    type: "expense",
    amount: 100,
    category: "need",
    date: utcToday(),
    note: "",
    ...body,
  });

test("a user in IST can add a transaction for their own today", async () => {
  const r = await add({ date: istToday() });
  assert.equal(r.status, 201, r.data.message);
});

test("future dates are rejected with 400", async () => {
  const r = await add({ date: daysFromUtcToday(2) });
  assert.equal(r.status, 400);
  assert.match(r.data.message, /future/);
});

test("dates before the current month are a 400 (used to crash with 500)", async () => {
  const r = await add({ date: "2026-01-05" });
  assert.equal(r.status, 400);
});

test("invalid amounts are rejected", async () => {
  for (const amount of [-5, 0, "abc", 1e12]) {
    const r = await add({ amount });
    assert.equal(r.status, 400, `amount ${amount}`);
  }
});

test("users can't create minutely recurring rules", async () => {
  const r = await add({ isRecurring: true, frequency: "minutely" });
  assert.equal(r.status, 400);
});

test("edit and delete a transaction", async () => {
  const created = await add({ note: "Lunch" });
  const id = created.data.data._id;
  const edited = await client.patch(`/user/update/transaction/${id}`, {
    type: "expense",
    amount: 250,
    category: "want",
    date: utcToday(),
    note: "Dinner",
  });
  assert.equal(edited.status, 200);
  assert.equal(edited.data.data.amount, 250);
  assert.equal(edited.data.data.note, "Dinner");
  const deleted = await client.del(`/user/transaction/delete/${id}`);
  assert.equal(deleted.status, 200);
  const gone = await client.get(`/user/transactions/${id}`);
  assert.equal(gone.status, 404);
});

test("invalid id is a 400, unknown id is a 404", async () => {
  assert.equal((await client.get("/user/transactions/not-an-id")).status, 400);
  assert.equal(
    (await client.del("/user/transaction/delete/6acfc41e2c30edc97f7a1d99"))
      .status,
    404
  );
});

test("a page past the end is empty, not an error", async () => {
  const r = await client.get("/user/transactions?page=999&limit=10");
  assert.equal(r.status, 200);
  assert.equal(r.data.data.transactions.length, 0);
});

test("users only ever see their own transactions", async () => {
  const mine = await add({ note: "private" });
  const { client: other } = await newUser(ctx);
  const r = await other.get(`/user/transactions/${mine.data.data._id}`);
  assert.equal(r.status, 404);
  const del = await other.del(`/user/transaction/delete/${mine.data.data._id}`);
  assert.equal(del.status, 404);
});

test("month list uses English month names", async () => {
  const r = await client.get("/user/transaction/dataMonthList");
  const name = new Date().toLocaleString("en-US", {
    month: "long",
    timeZone: "UTC",
  });
  assert.equal(r.data.data[0].month, name);
});

test("Excel export is a real xlsx and notes never become formulas", async () => {
  await add({ note: '=HYPERLINK("http://x") groceries' });
  const [y, m] = utcToday().split("-");
  const r = await client.get(
    `/user/transactions/export/excel?month=${Number(m)}&year=${y}`
  );
  assert.equal(r.status, 200);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(r.data));
  const ws = wb.getWorksheet("Transactions");
  const notes = [];
  ws.eachRow((row, i) => i > 1 && notes.push(row.getCell(3)));
  const evil = notes.find((c) => String(c.value).startsWith("=HYPERLINK"));
  assert.ok(evil, "note exported");
  assert.equal(evil.type, ExcelJS.ValueType.String);
});
