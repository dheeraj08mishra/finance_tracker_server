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

test("profile: no default photo; set and remove one", async () => {
  const { client } = await newUser(ctx);
  assert.equal((await client.get("/me")).data.user.photo, null);
  let r = await client.patch("/user/profile/update", {
    photo: "https://example.com/me.png",
  });
  assert.equal(r.data.user.photo, "https://example.com/me.png");
  r = await client.patch("/user/profile/update", { photo: "" });
  assert.equal(r.data.user.photo, null);
});

test("profile: every field optional; unsafe photo links rejected", async () => {
  const { client } = await newUser(ctx);
  assert.equal(
    (await client.patch("/user/profile/update", { firstName: "Renamed" }))
      .status,
    200
  );
  assert.equal(
    (
      await client.patch("/user/profile/update", {
        photo: "javascript:alert(1)",
      })
    ).status,
    400
  );
  assert.equal(
    (await client.patch("/user/profile/update", { phoneNumber: "12" })).status,
    400
  );
});

test("change password: wrong current is 403 (not a session error), weak is 400", async () => {
  const { client, password } = await newUser(ctx);
  assert.equal(
    (
      await client.patch("/user/password", {
        currentPassword: "Wrong1@xx",
        newPassword: "NewPass1@",
      })
    ).status,
    403
  );
  assert.equal(
    (
      await client.patch("/user/password", {
        currentPassword: password,
        newPassword: "weak",
      })
    ).status,
    400
  );
  assert.equal(
    (
      await client.patch("/user/password", {
        currentPassword: password,
        newPassword: " Spaced1@ ",
      })
    ).status,
    400
  );
});

test("change password signs out other devices and keeps this one", async () => {
  const { client, email, password } = await newUser(ctx);
  const other = ctx.client();
  assert.equal((await other.post("/login", { email, password })).status, 200);

  const r = await client.patch("/user/password", {
    currentPassword: password,
    newPassword: "NewPass1@",
  });
  assert.equal(r.status, 200);
  assert.equal((await client.get("/me")).status, 200, "this device stays in");
  assert.equal((await other.get("/me")).status, 401, "other device is out");

  const fresh = ctx.client();
  assert.equal(
    (await fresh.post("/login", { email, password })).status,
    401,
    "old password"
  );
  assert.equal(
    (await fresh.post("/login", { email, password: "NewPass1@" })).status,
    200,
    "new password"
  );
});

test("none of the last 3 passwords can be reused", async () => {
  const { client, email } = await newUser(ctx, "Pass1@aaa");
  const change = (from, to) =>
    client.patch("/user/password", { currentPassword: from, newPassword: to });
  assert.equal((await change("Pass1@aaa", "Pass1@aaa")).status, 400, "current");
  assert.equal((await change("Pass1@aaa", "Pass2@bbb")).status, 200);
  assert.equal((await change("Pass2@bbb", "Pass3@ccc")).status, 200);
  assert.equal(
    (await change("Pass3@ccc", "Pass1@aaa")).status,
    400,
    "A is one of the last 3"
  );
  assert.equal(
    (await change("Pass3@ccc", "Pass2@bbb")).status,
    400,
    "B is one of the last 3"
  );
  assert.equal((await change("Pass3@ccc", "Pass4@ddd")).status, 200);
  assert.equal(
    (await change("Pass4@ddd", "Pass1@aaa")).status,
    200,
    "A is 4th oldest now"
  );
  assert.equal(
    (await ctx.client().post("/login", { email, password: "Pass1@aaa" }))
      .status,
    200
  );
});
