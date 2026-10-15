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

test("preferences: defaults, save, survive sign-in, validated", async () => {
  const { client, email, password } = await newUser(ctx);
  assert.deepEqual((await client.get("/me")).data.user.preferences, {
    defaultCategory: "need",
    defaultFrequency: "monthly",
  });

  const r = await client.patch("/user/preferences", {
    defaultCategory: "want",
  });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.preferences, {
    defaultCategory: "want",
    defaultFrequency: "monthly",
  });
  await client.patch("/user/preferences", { defaultFrequency: "weekly" });

  // a new sign-in gets them too
  const other = ctx.client();
  const login = await other.post("/login", { email, password });
  assert.deepEqual(login.data.user.preferences, {
    defaultCategory: "want",
    defaultFrequency: "weekly",
  });

  for (const body of [
    {},
    { defaultCategory: "goal" }, // goals are added from the Goals page
    { defaultFrequency: "minutely" }, // test-only frequency
    { theme: "dark" },
  ]) {
    const bad = await client.patch("/user/preferences", body);
    assert.equal(bad.status, 400, JSON.stringify(body));
  }
});

test("accounts from before preferences existed get the defaults", async () => {
  const { client, email } = await newUser(ctx);
  await User.collection.updateOne({ email }, { $unset: { preferences: "" } });
  assert.deepEqual((await client.get("/me")).data.user.preferences, {
    defaultCategory: "need",
    defaultFrequency: "monthly",
  });
  const r = await client.patch("/user/preferences", {
    defaultCategory: "investment",
  });
  assert.equal(r.data.preferences.defaultCategory, "investment");
  assert.equal(r.data.preferences.defaultFrequency, "monthly");
});
