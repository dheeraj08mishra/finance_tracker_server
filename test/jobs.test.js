import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";
import { claimRun, runOnce, dailyJob } from "../src/utils/cron/jobs.js";
import JobRun from "../src/model/jobRun.js";

let ctx;
before(async () => {
  ctx = await startServer();
});
after(async () => {
  await ctx.stop();
});

const quiet = () => {};

test("several processes start the same job: it runs once", async () => {
  let runs = 0;
  const results = await Promise.all(
    Array.from({ length: 5 }, () =>
      runOnce(
        "test:concurrent",
        async () => {
          runs++;
          await new Promise((r) => setTimeout(r, 50));
          return { ok: 1 };
        },
        quiet
      )
    )
  );
  assert.equal(runs, 1);
  assert.equal(results.filter(Boolean).length, 1);
  const doc = await JobRun.findById("test:concurrent").lean();
  assert.ok(doc.finishedAt);
  assert.deepEqual(doc.result, { ok: 1 });
  // and it doesn't run again later in the same period
  assert.equal(
    await runOnce("test:concurrent", async () => runs++, quiet),
    null
  );
  assert.equal(runs, 1);
});

test("a crashed run can be taken over once it's stale, not before", async () => {
  const now = new Date();
  await JobRun.create({
    _id: "test:fresh",
    startedAt: new Date(now - 5 * 60e3),
    expiresAt: new Date(now.getTime() + 86400e3),
  });
  assert.equal(await claimRun("test:fresh", now), false);

  await JobRun.create({
    _id: "test:stale",
    startedAt: new Date(now - 2 * 3600e3),
    expiresAt: new Date(now.getTime() + 86400e3),
  });
  assert.equal(await claimRun("test:stale", now), true);
  // only one taker
  assert.equal(await claimRun("test:stale", now), false);
});

test("a failing job records the error and isn't retried right away", async () => {
  await assert.rejects(
    runOnce(
      "test:fails",
      async () => {
        throw new Error("SES down");
      },
      quiet
    ),
    /SES down/
  );
  const doc = await JobRun.findById("test:fails").lean();
  assert.equal(doc.error, "SES down");
  assert.equal(doc.finishedAt, null);
  assert.equal(await runOnce("test:fails", async () => 1, quiet), null);
});

test("the daily job runs once per day even if two processes fire it", async () => {
  const [a, b] = await Promise.all([dailyJob(), dailyJob()]);
  assert.equal([a, b].filter(Boolean).length, 1);
  const today = new Date().toISOString().slice(0, 10);
  const doc = await JobRun.findById(`daily:${today}`).lean();
  assert.ok(doc.finishedAt);
});
