import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, newUser } from "./helpers.js";
import { setRole } from "../src/utils/admin.js";

let ctx;
before(async () => {
  ctx = await startServer();
});
after(async () => {
  await ctx.stop();
});

test("new accounts are regular users", async () => {
  const { client } = await newUser(ctx);
  assert.equal((await client.get("/me")).data.user.role, "user");
});

test("admin pages: 401 signed out, 403 for regular users", async () => {
  assert.equal((await ctx.client().get("/admin/stats")).status, 401);
  const { client } = await newUser(ctx);
  assert.equal((await client.get("/admin/stats")).status, 403);
  assert.equal((await client.get("/admin/feedback")).status, 403);
});

test("users can't make themselves admin through the profile", async () => {
  const { client } = await newUser(ctx);
  await client.patch("/user/profile/update", {
    role: "admin",
    firstName: "Sneaky",
  });
  assert.equal((await client.get("/me")).data.user.role, "user");
  assert.equal((await client.get("/admin/stats")).status, 403);
});

test("admin: stats and feedback with who sent it", async () => {
  const { client: admin, email } = await newUser(ctx);
  assert.equal((await setRole(email, "admin")).role, "admin");

  const { client: u1 } = await newUser(ctx);
  const { client: u2 } = await newUser(ctx);
  await u1.post("/user/submitFeedback", {
    feedbackText: "Dark mode is great",
    feedbackType: "suggestion",
  });
  await u2.post("/user/submitFeedback", {
    feedbackText: "Export crashed once",
    feedbackType: "bug",
  });
  await u2.post("/user/submitFeedback", {
    feedbackText: "Add budgets please",
    feedbackType: "feature",
  });

  const stats = await admin.get("/admin/stats");
  assert.equal(stats.status, 200);
  assert.ok(stats.data.users >= 3);
  assert.ok(stats.data.newThisWeek >= 3);
  assert.equal(stats.data.feedback.total, 3);
  assert.equal(stats.data.feedback.bug, 1);

  const all = await admin.get("/admin/feedback");
  assert.equal(all.data.pagination.total, 3);
  assert.equal(all.data.data[0].text, "Add budgets please", "newest first");
  assert.match(all.data.data[0].user.email, /@example\.com$/);

  const bugs = await admin.get("/admin/feedback?type=bug");
  assert.deepEqual(
    bugs.data.data.map((f) => f.text),
    ["Export crashed once"]
  );
  assert.equal((await admin.get("/admin/feedback?type=nonsense")).status, 400);

  const paged = await admin.get("/admin/feedback?limit=2&page=2");
  assert.equal(paged.data.data.length, 1);
});

test("admin can be revoked; unknown emails are reported", async () => {
  const { client, email } = await newUser(ctx);
  await setRole(email, "admin");
  assert.equal((await client.get("/admin/stats")).status, 200);
  await setRole(email, "user");
  assert.equal((await client.get("/admin/stats")).status, 403);
  assert.equal(await setRole("nobody@example.com", "admin"), null);
});
