import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { startServer, newUser } from "./helpers.js";
import { deviceLabel } from "../src/utils/sessions.js";
import User from "../src/model/user.js";
import Session from "../src/model/session.js";

let ctx;
before(async () => {
  ctx = await startServer();
});
after(async () => {
  await ctx.stop();
});

// Another browser signing in to the same account
const device = async (email, password) => {
  const c = ctx.client();
  const r = await c.post("/login", { email, password });
  assert.equal(r.status, 200);
  return c;
};

test("device labels from common browsers", () => {
  assert.equal(
    deviceLabel(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36"
    ),
    "Chrome on macOS"
  );
  assert.equal(
    deviceLabel(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"
    ),
    "Safari on iOS"
  );
  assert.equal(
    deviceLabel(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36 Edg/141.0"
    ),
    "Edge on Windows"
  );
  assert.equal(
    deviceLabel(
      "Mozilla/5.0 (Android 15; Mobile; rv:143.0) Gecko/143.0 Firefox/143.0"
    ),
    "Firefox on Android"
  );
  assert.equal(deviceLabel(""), "Browser");
});

test("list devices and sign one out; it is refused on its next request", async () => {
  const { client: a, email, password } = await newUser(ctx);
  const b = await device(email, password);

  const list = (await a.get("/user/sessions")).data;
  assert.equal(list.data.length, 2);
  assert.equal(list.data.filter((s) => s.current).length, 1);
  assert.equal(list.currentListed, true);
  // the record lives exactly as long as the login token
  const doc = await Session.findById(list.data[0]._id);
  const hours = (doc.expiresAt - doc.createdAt) / 3600e3;
  assert.ok(hours > 23.9 && hours <= 24, String(hours));
  const other = list.data.find((s) => !s.current);

  // can't end your own session here, nor someone else's
  const mine = list.data.find((s) => s.current);
  assert.equal((await a.del(`/user/sessions/${mine._id}`)).status, 400);
  const { client: stranger } = await newUser(ctx);
  assert.equal((await stranger.del(`/user/sessions/${other._id}`)).status, 404);
  assert.equal((await a.del("/user/sessions/nope")).status, 400);

  assert.equal((await a.del(`/user/sessions/${other._id}`)).status, 200);
  const refused = await b.get("/me");
  assert.equal(refused.status, 401);
  assert.match(refused.data.message, /signed out/);
  assert.equal((await a.get("/me")).status, 200);
});

test("sign out all other devices", async () => {
  const { client: a, email, password } = await newUser(ctx);
  const b = await device(email, password);
  const c = await device(email, password);
  const r = await a.post("/user/sessions/sign-out-others");
  assert.equal(r.data.count, 2);
  assert.equal((await b.get("/me")).status, 401);
  assert.equal((await c.get("/me")).status, 401);
  assert.equal((await a.get("/me")).status, 200);
  assert.equal((await a.get("/user/sessions")).data.data.length, 1);
});

test("logout ends the session; a password change keeps only this device", async () => {
  const { client: a, email, password } = await newUser(ctx);
  const b = await device(email, password);
  await b.post("/logout");
  assert.equal((await a.get("/user/sessions")).data.data.length, 1);

  const c = await device(email, password);
  const changed = await a.patch("/user/password", {
    currentPassword: password,
    newPassword: "Another1@pass",
  });
  assert.equal(changed.status, 200);
  assert.equal((await c.get("/me")).status, 401);
  const after = (await a.get("/user/sessions")).data.data;
  assert.equal(after.length, 1);
  assert.equal(after[0].current, true);
});

test("tokens from before sessions keep working until they expire", async () => {
  const { email } = await newUser(ctx);
  const user = await User.findOne({ email });
  const old = jwt.sign({ userId: user._id, tv: 0 }, process.env.JWT_SECRET, {
    expiresIn: "1d",
  });
  const r = await fetch(`${ctx.url}/user/sessions`, {
    headers: { cookie: `token=${old}` },
  });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).currentListed, false);
});
