import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, newUser } from "./helpers.js";
import User from "../src/model/user.js";

let ctx;
before(async () => {
  ctx = await startServer();
});
after(async () => {
  await ctx.stop();
});

// Locally the server prints the reset link; read it like a developer would
async function requestLink(email) {
  const lines = [];
  const original = console.log;
  console.log = (...args) => lines.push(args.join(" "));
  try {
    const r = await ctx.client().post("/password/forgot", { email });
    const line = lines.find((l) => l.includes("[DEV] Password reset link"));
    const token = line?.match(/token=([a-f0-9]{64})/)?.[1] ?? null;
    return { r, token };
  } finally {
    console.log = original;
  }
}
const reset = (token, newPassword) =>
  ctx.client().post("/password/reset", { token, newPassword });

test("forgot: same answer for known and unknown emails", async () => {
  const { email } = await newUser(ctx);
  const known = await requestLink(email);
  const unknown = await requestLink("nobody@example.com");
  assert.equal(known.r.status, 200);
  assert.equal(unknown.r.status, 200);
  assert.equal(known.r.data.message, unknown.r.data.message);
  assert.ok(known.token, "a link was created for the real account");
  assert.equal(unknown.token, null, "no link for an unknown email");
});

test("forgot: invalid email is a 400", async () => {
  const r = await ctx.client().post("/password/forgot", { email: "nope" });
  assert.equal(r.status, 400);
});

test("only a hash of the token is stored", async () => {
  const { email } = await newUser(ctx);
  const { token } = await requestLink(email);
  const user = await User.findOne({ email }).select("+passwordResetTokenHash");
  assert.ok(user.passwordResetTokenHash);
  assert.notEqual(user.passwordResetTokenHash, token);
});

test("reset: new password works, old fails, other sessions signed out, link single-use", async () => {
  const { client, email, password } = await newUser(ctx);
  const { token } = await requestLink(email);

  const r = await reset(token, "Reset#Pass1");
  assert.equal(r.status, 200, r.data.message);
  assert.equal(
    (await client.get("/me")).status,
    401,
    "existing session signed out"
  );

  const c = ctx.client();
  assert.equal(
    (await c.post("/login", { email, password })).status,
    401,
    "old password"
  );
  assert.equal(
    (await c.post("/login", { email, password: "Reset#Pass1" })).status,
    200
  );

  const again = await reset(token, "Another#Pass2");
  assert.equal(again.status, 400, "a link works once");
});

test("reset: weak, reused or malformed passwords and tokens are refused", async () => {
  const { email, password } = await newUser(ctx);
  const { token } = await requestLink(email);
  assert.equal((await reset(token, "weak")).status, 400);
  assert.equal(
    (await reset(token, password)).status,
    400,
    "current password is one of the last 3"
  );
  assert.equal((await reset("not-a-token", "Fine#Pass123")).status, 400);
  assert.equal(
    (await reset("a".repeat(64), "Fine#Pass123")).status,
    400,
    "unknown token"
  );
  assert.equal(
    (await reset(token, "Fine#Pass123")).status,
    200,
    "refusals didn't burn the link"
  );
});

test("reset: expired links are refused; a new request replaces the old link", async () => {
  const { email } = await newUser(ctx);
  const first = await requestLink(email);
  const second = await requestLink(email);
  assert.equal(
    (await reset(first.token, "Fine#Pass123")).status,
    400,
    "replaced"
  );

  await User.updateOne(
    { email },
    { passwordResetExpires: new Date(Date.now() - 1000) }
  );
  assert.equal(
    (await reset(second.token, "Fine#Pass123")).status,
    400,
    "expired"
  );
});
