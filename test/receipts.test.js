import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { startServer, newUser, monthStart } from "./helpers.js";
import { sniff } from "../src/utils/receiptStorage.js";

let ctx;
before(async () => {
  ctx = await startServer();
});
after(async () => {
  await ctx.stop();
});

// Smallest files that look like the real thing
const PNG = Buffer.concat([
  Buffer.from("89504e470d0a1a0a", "hex"),
  Buffer.alloc(40, 1),
]);
const JPG = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  Buffer.alloc(40),
]);
const PDF = Buffer.from("%PDF-1.4\n%fake but enough to sniff\n");
const onDisk = (key) => existsSync(path.join(process.env.RECEIPTS_DIR, key));

const addExpense = async (client) =>
  (
    await client.post("/user/addTransaction", {
      type: "expense",
      amount: 450,
      category: "need",
      date: monthStart(),
      note: "Pharmacy",
    })
  ).data.data._id;

test("file type comes from the bytes, not the name", () => {
  assert.equal(sniff(PNG).contentType, "image/png");
  assert.equal(sniff(JPG).contentType, "image/jpeg");
  assert.equal(sniff(PDF).contentType, "application/pdf");
  const webp = Buffer.concat([
    Buffer.from("RIFF"),
    Buffer.alloc(4),
    Buffer.from("WEBPVP8 "),
  ]);
  assert.equal(sniff(webp).contentType, "image/webp");
  assert.equal(sniff(Buffer.from("<html><script>alert(1)</script>")), null);
  assert.equal(sniff(Buffer.alloc(3)), null);
});

test("attach, view, replace and remove a receipt", async () => {
  const { client } = await newUser(ctx);
  const id = await addExpense(client);
  const url = `/user/transaction/${id}/receipt`;

  const up = await client.upload(url, PNG, { "x-file-name": "bill<1>.png" });
  assert.equal(up.status, 200);
  assert.equal(up.data.receipt.contentType, "image/png");
  assert.equal(up.data.receipt.size, PNG.length);
  assert.equal(up.data.receipt.name, "bill1.png");
  const firstKey = up.data.receipt.key;
  assert.ok(onDisk(firstKey));

  // shows up on the transaction
  const txn = (await client.get(`/user/transactions/${id}`)).data.data;
  assert.equal(txn.receipt.contentType, "image/png");

  const view = await client.get(url);
  assert.equal(view.status, 200);
  assert.equal(view.headers.get("content-type"), "image/png");
  assert.match(view.headers.get("content-security-policy"), /sandbox/);
  assert.deepEqual(Buffer.from(view.data), PNG);

  // replacing deletes the old file
  const pdf = await client.upload(url, PDF, {
    "x-file-name": encodeURIComponent("दवा बिल.pdf"),
  });
  assert.equal(pdf.data.receipt.name, "दवा बिल.pdf");
  assert.equal(pdf.data.receipt.contentType, "application/pdf");
  assert.ok(!onDisk(firstKey));
  assert.ok(onDisk(pdf.data.receipt.key));

  const del = await client.del(url);
  assert.equal(del.status, 200);
  assert.ok(!onDisk(pdf.data.receipt.key));
  assert.equal((await client.get(url)).status, 404);
});

test("refused: wrong type, empty, too big, someone else's", async () => {
  const { client } = await newUser(ctx);
  const id = await addExpense(client);
  const url = `/user/transaction/${id}/receipt`;
  assert.equal(
    (await client.upload(url, Buffer.from("<svg onload=alert(1)>"))).status,
    415
  );
  assert.equal((await client.upload(url, Buffer.alloc(0))).status, 400);
  const big = Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]);
  const tooBig = await client.upload(url, big);
  assert.equal(tooBig.status, 413);
  assert.match(tooBig.data.message, /5 MB/);

  await client.upload(url, JPG);
  const { client: other } = await newUser(ctx);
  assert.equal((await other.get(url)).status, 404);
  assert.equal((await other.upload(url, PNG)).status, 404);
  assert.equal((await other.del(url)).status, 404);
  assert.equal(
    (await client.upload("/user/transaction/nope/receipt", PNG)).status,
    404
  );
});

test("deleting the transaction deletes its receipt file", async () => {
  const { client } = await newUser(ctx);
  const id = await addExpense(client);
  const { key } = (await client.upload(`/user/transaction/${id}/receipt`, JPG))
    .data.receipt;
  assert.ok(onDisk(key));
  await client.del(`/user/transaction/delete/${id}`);
  assert.ok(!onDisk(key));
});
