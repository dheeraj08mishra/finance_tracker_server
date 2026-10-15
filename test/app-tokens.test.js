import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import jwt from "jsonwebtoken";
import { startServer, newUser } from "./helpers.js";
import Session from "../src/model/session.js";

let ctx;
before(async () => {
  ctx = await startServer();
});
after(async () => {
  await ctx.stop();
});

const APP = { "x-auth-mode": "token", "x-device-name": "Pixel 8" };

// A phone app: no cookie jar use, just tokens
async function appLogin(email, password) {
  const c = ctx.client();
  const r = await c.send("POST", "/login", { email, password }, APP);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("set-cookie"), null, "no cookie for the app");
  return r.data.tokens;
}
const asApp = (method, path, accessToken, body) =>
  ctx.client().send(method, path, body, {
    authorization: `Bearer ${accessToken}`,
  });

test("app sign-in: tokens instead of a cookie; listed as a device", async () => {
  const { client: web, email, password } = await newUser(ctx);
  const tokens = await appLogin(email, password);
  assert.equal(tokens.expiresIn, 900);
  assert.ok(tokens.refreshToken.length >= 40);
  assert.equal(
    jwt.decode(tokens.accessToken).exp - jwt.decode(tokens.accessToken).iat,
    900
  );

  const me = await asApp("GET", "/me", tokens.accessToken);
  assert.equal(me.status, 200);
  assert.equal(me.data.user.email, email);

  const fromApp = (await asApp("GET", "/user/sessions", tokens.accessToken))
    .data.data;
  const appRow = fromApp.find((s) => s.current);
  assert.equal(appRow.device, "Pixel 8");
  // the website sees it as another device
  const fromWeb = (await web.get("/user/sessions")).data.data;
  assert.ok(fromWeb.some((s) => s.device === "Pixel 8" && !s.current));
  // only a hash of the refresh token is stored
  const doc = await Session.findById(appRow._id).lean();
  assert.notEqual(doc.refreshHash, tokens.refreshToken);
});

test("refresh rotates tokens; a reused old token ends the session", async () => {
  const { email, password } = await newUser(ctx);
  const first = await appLogin(email, password);
  const r = await ctx.client().post("/auth/refresh", {
    refreshToken: first.refreshToken,
  });
  assert.equal(r.status, 200);
  const second = r.data.tokens;
  assert.notEqual(second.refreshToken, first.refreshToken);
  assert.equal((await asApp("GET", "/me", second.accessToken)).status, 200);

  // the old token right away: a retry race, the session survives
  const race = await ctx.client().post("/auth/refresh", {
    refreshToken: first.refreshToken,
  });
  assert.equal(race.status, 409);
  assert.equal((await asApp("GET", "/me", second.accessToken)).status, 200);

  // the old token later: treated as stolen, the session is ended
  const hash = createHash("sha256").update(first.refreshToken).digest("hex");
  await Session.updateOne(
    { previousRefreshHash: hash },
    { rotatedAt: new Date(Date.now() - 60e3) }
  );
  const stolen = await ctx.client().post("/auth/refresh", {
    refreshToken: first.refreshToken,
  });
  assert.equal(stolen.status, 401);
  assert.equal((await asApp("GET", "/me", second.accessToken)).status, 401);
  const after = await ctx.client().post("/auth/refresh", {
    refreshToken: second.refreshToken,
  });
  assert.equal(after.status, 401);
});

test("two refreshes at once: exactly one wins", async () => {
  const { email, password } = await newUser(ctx);
  const t = await appLogin(email, password);
  const results = await Promise.all(
    [1, 2, 3].map(() =>
      ctx.client().post("/auth/refresh", { refreshToken: t.refreshToken })
    )
  );
  assert.equal(results.filter((r) => r.status === 200).length, 1);
  assert.ok(results.every((r) => [200, 409].includes(r.status)));
});

test("signing out from the website or changing the password cuts the app off", async () => {
  const { client: web, email, password } = await newUser(ctx);
  const t = await appLogin(email, password);
  await web.post("/user/sessions/sign-out-others");
  assert.equal((await asApp("GET", "/me", t.accessToken)).status, 401);
  assert.equal(
    (await ctx.client().post("/auth/refresh", { refreshToken: t.refreshToken }))
      .status,
    401
  );

  const t2 = await appLogin(email, password);
  await web.patch("/user/password", {
    currentPassword: password,
    newPassword: "Changed1@pass",
  });
  assert.equal((await asApp("GET", "/me", t2.accessToken)).status, 401);
  assert.equal(
    (
      await ctx
        .client()
        .post("/auth/refresh", { refreshToken: t2.refreshToken })
    ).status,
    401
  );
});

test("app logout with the refresh token; bad tokens are refused", async () => {
  const { email, password } = await newUser(ctx);
  const t = await appLogin(email, password);
  const out = await ctx
    .client()
    .post("/logout", { refreshToken: t.refreshToken });
  assert.equal(out.status, 200);
  assert.equal((await asApp("GET", "/me", t.accessToken)).status, 401);

  // an expired access token
  const t2 = await appLogin(email, password);
  const { userId, sid, tv } = jwt.decode(t2.accessToken);
  const expired = jwt.sign(
    { userId, sid, tv, exp: Math.floor(Date.now() / 1000) - 10 },
    process.env.JWT_SECRET
  );
  assert.equal((await asApp("GET", "/me", expired)).status, 401);
  // a bearer token without a session id
  const noSid = jwt.sign({ userId, tv }, process.env.JWT_SECRET, {
    expiresIn: "1h",
  });
  assert.equal((await asApp("GET", "/me", noSid)).status, 401);
  // junk
  assert.equal((await ctx.client().post("/auth/refresh", {})).status, 400);
  assert.equal(
    (await ctx.client().post("/auth/refresh", { refreshToken: "x".repeat(43) }))
      .status,
    401
  );
});

test("app sign-up returns tokens too; the website still gets its cookie", async () => {
  const c = ctx.client();
  const r = await c.send(
    "POST",
    "/signup",
    {
      firstName: "Mobile",
      lastName: "User",
      email: `app${Date.now()}@example.com`,
      password: "Mobile1@pass",
      phoneNumber: String(9500000000 + Math.floor(Math.random() * 499999999)),
    },
    APP
  );
  assert.equal(r.status, 201);
  assert.ok(r.data.tokens.accessToken);
  const web = ctx.client();
  const w = await web.post("/login", {
    email: r.data.user.email,
    password: "Mobile1@pass",
  });
  assert.equal(w.data.tokens, undefined);
  assert.match(w.headers.get("set-cookie"), /^token=/);
});
