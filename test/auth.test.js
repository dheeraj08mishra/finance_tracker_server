import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, newUser } from "./helpers.js";

let ctx;
before(async () => {
  ctx = await startServer();
});
after(async () => {
  await ctx.stop();
});

test("health check reports the database", async () => {
  const r = await ctx.client().get("/health");
  assert.equal(r.status, 200);
  assert.deepEqual(r.data, { status: "ok", db: "up" });
});

test("signup with missing fields is a 400, not a crash", async () => {
  const r = await ctx.client().post("/signup", { email: "x@example.com" });
  assert.equal(r.status, 400);
});

test("signup rejects a weak password", async () => {
  const r = await ctx.client().post("/signup", {
    firstName: "Weak",
    lastName: "Pass",
    email: "weak@example.com",
    password: "password",
    phoneNumber: "9876500000",
  });
  assert.equal(r.status, 400);
});

test("login gives the same answer for unknown email and wrong password", async () => {
  const { email } = await newUser(ctx);
  const wrongPw = await ctx
    .client()
    .post("/login", { email, password: "Wrong1@xx" });
  const unknown = await ctx
    .client()
    .post("/login", { email: "nobody@example.com", password: "Wrong1@xx" });
  assert.equal(wrongPw.status, 401);
  assert.equal(unknown.status, 401);
  assert.equal(wrongPw.data.message, unknown.data.message);
});

test("gmail addresses with dots can log in (stored normalized)", async () => {
  const c = ctx.client();
  const r = await c.post("/signup", {
    firstName: "John",
    lastName: "Doee",
    email: "John.Doe@gmail.com",
    password: "Testuser1@",
    phoneNumber: "9876511111",
  });
  assert.equal(r.status, 201);
  const login = await ctx
    .client()
    .post("/login", { email: "john.doe@gmail.com", password: "Testuser1@" });
  assert.equal(login.status, 200);
});

test("auth cookie is httpOnly and SameSite=Strict; logout clears it", async () => {
  const { email, password } = await newUser(ctx);
  const c = ctx.client();
  const r = await c.post("/login", { email, password });
  const cookie = r.headers.get("set-cookie");
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  const out = await c.post("/logout");
  assert.match(out.headers.get("set-cookie"), /token=;/);
});

test("security headers are set and x-powered-by is hidden", async () => {
  const r = await ctx.client().get("/health");
  assert.ok(r.headers.get("content-security-policy"));
  assert.equal(r.headers.get("x-powered-by"), null);
});

test("protected routes need a session", async () => {
  const c = ctx.client();
  for (const [method, path] of [
    ["post", "/sync"],
    ["get", "/recurring-transactions"],
    ["get", "/me"],
    ["get", "/user/transactions"],
  ]) {
    const r = await c[method](path);
    assert.equal(r.status, 401, `${method.toUpperCase()} ${path}`);
  }
});

test("/me returns the user without password data", async () => {
  const { client } = await newUser(ctx);
  const r = await client.get("/me");
  assert.equal(r.status, 200);
  for (const field of [
    "password",
    "passwordHistory",
    "passwordChangedAt",
    "tokenVersion",
  ]) {
    assert.ok(!(field in r.data.user), field);
  }
});

test("sign-up: a mobile number already in use gets a clear 400, not a 500", async () => {
  const phoneNumber = "9" + String(Date.now()).slice(-9);
  const body = (email) => ({
    firstName: "Phone",
    lastName: "Taken",
    email,
    password: "Testuser1@",
    phoneNumber,
  });
  const first = await ctx
    .client()
    .post("/signup", body(`p1${Date.now()}@example.com`));
  assert.equal(first.status, 201);
  const second = await ctx
    .client()
    .post("/signup", body(`p2${Date.now()}@example.com`));
  assert.equal(second.status, 400);
  assert.match(second.data.message, /mobile number is already registered/);

  // same moment, same number: one wins, the other gets the same clear 400
  const race = "8" + String(Date.now()).slice(-9);
  const results = await Promise.all(
    [1, 2].map((n) =>
      ctx.client().post("/signup", {
        ...body(`race${n}${Date.now()}@example.com`),
        phoneNumber: race,
      })
    )
  );
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 400]);

  // no phone at all: a clear 400 (it's required), not a 500
  const noPhone = await ctx.client().post("/signup", {
    ...body(`nophone${Date.now()}@example.com`),
    phoneNumber: undefined,
  });
  assert.equal(noPhone.status, 400);
  assert.match(noPhone.data.message, /Phone number is required/);
});
