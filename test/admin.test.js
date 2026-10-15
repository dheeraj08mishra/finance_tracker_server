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

// ---------- users list, activity, feedback triage ----------
async function anAdmin() {
  const u = await newUser(ctx);
  await setRole(u.email, "admin");
  return u.client;
}

test("users list: search, paging, usage counts, nothing sensitive", async () => {
  const admin = await anAdmin();
  const { client: u, email } = await newUser(ctx);
  for (const amount of [100, 200]) {
    await u.post("/user/addTransaction", {
      type: "expense",
      amount,
      category: "need",
      date: new Date().toISOString().slice(0, 10),
      note: "",
    });
  }
  const r = await admin.get(`/admin/users?search=${encodeURIComponent(email)}`);
  assert.equal(r.status, 200);
  assert.equal(r.data.data.length, 1);
  const row = r.data.data[0];
  assert.equal(row.email, email);
  assert.equal(row.transactions, 2);
  assert.ok(row.lastTransactionAt);
  assert.ok(row.lastLoginAt, "sign-up counts as a sign-in");
  for (const k of [
    "password",
    "passwordHistory",
    "budgets",
    "tokenVersion",
    "amount",
  ]) {
    assert.ok(!(k in row), `${k} must not be exposed`);
  }
  const page = await admin.get("/admin/users?limit=2&page=1");
  assert.equal(page.data.data.length, 2);
  assert.ok(page.data.pagination.total >= 3);
  const regex = await admin.get("/admin/users?search=.*");
  assert.equal(regex.status, 200, "search text is not a regex");
  assert.equal(regex.data.data.length, 0);
});

test("last sign-in is updated on login", async () => {
  const admin = await anAdmin();
  const { email, password } = await newUser(ctx);
  const before = (
    await admin.get(`/admin/users?search=${encodeURIComponent(email)}`)
  ).data.data[0].lastLoginAt;
  await new Promise((r) => setTimeout(r, 20));
  await ctx.client().post("/login", { email, password });
  const after = (
    await admin.get(`/admin/users?search=${encodeURIComponent(email)}`)
  ).data.data[0].lastLoginAt;
  assert.ok(new Date(after) > new Date(before));
});

test("activity: sign-ups per week and active users per month", async () => {
  const admin = await anAdmin();
  const { client: u } = await newUser(ctx);
  await u.post("/user/addTransaction", {
    type: "expense",
    amount: 50,
    category: "want",
    date: new Date().toISOString().slice(0, 10),
    note: "",
  });
  const r = await admin.get("/admin/activity");
  assert.equal(r.status, 200);
  assert.equal(r.data.signupsPerWeek.length, 12);
  assert.equal(r.data.activePerMonth.length, 6);
  assert.ok(r.data.signupsPerWeek.at(-1).count >= 2, "this week's sign-ups");
  assert.ok(
    r.data.activePerMonth.at(-1).count >= 1,
    "this month's active users"
  );
  assert.equal(typeof r.data.totals.goals, "number");
  assert.equal((await u.get("/admin/activity")).status, 403);
});

test("feedback triage: status and note, filters, validation, admins only", async () => {
  const admin = await anAdmin();
  const { client: u } = await newUser(ctx);
  await u.post("/user/submitFeedback", {
    feedbackText: "Please add CSV import",
    feedbackType: "feature",
  });
  const list = await admin.get("/admin/feedback?status=new&type=feature");
  const item = list.data.data.find((f) => f.text === "Please add CSV import");
  assert.equal(item.status, "new");

  const r = await admin.patch(`/admin/feedback/${item._id}`, {
    status: "done",
    note: "Planned for Part 2",
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.data.status, "done");
  assert.equal(r.data.data.adminNote, "Planned for Part 2");

  const done = await admin.get("/admin/feedback?status=done");
  assert.ok(
    done.data.data.some(
      (f) => f._id === item._id && f.adminNote === "Planned for Part 2"
    )
  );
  const stillNew = await admin.get("/admin/feedback?status=new");
  assert.ok(!stillNew.data.data.some((f) => f._id === item._id));

  assert.equal(
    (await admin.patch(`/admin/feedback/${item._id}`, { status: "closed" }))
      .status,
    400
  );
  assert.equal(
    (await admin.patch(`/admin/feedback/${item._id}`, {})).status,
    400
  );
  assert.equal(
    (
      await admin.patch(`/admin/feedback/${item._id}`, {
        note: "x".repeat(501),
      })
    ).status,
    400
  );
  assert.equal(
    (await admin.patch("/admin/feedback/nope", { status: "seen" })).status,
    400
  );
  assert.equal(
    (
      await admin.patch("/admin/feedback/6acfc41e2c30edc97f7a1d99", {
        status: "seen",
      })
    ).status,
    404
  );
  assert.equal(
    (await u.patch(`/admin/feedback/${item._id}`, { status: "seen" })).status,
    403
  );
});
