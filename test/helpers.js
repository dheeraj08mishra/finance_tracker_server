// Test harness: in-memory MongoDB replica set (transactions need one) +
// the real Express app on a random port. Nothing touches a real database.
import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.JWT_SECRET ||= "test-secret";
process.env.OPENAI_API_KEY = "disabled-in-tests"; // tag extraction returns []
process.env.AUTH_RATE_LIMIT = "10000";
process.env.API_RATE_LIMIT = "100000";
// receipts go to a throwaway folder, never the real uploads/
process.env.RECEIPTS_DIR ||= mkdtempSync(path.join(tmpdir(), "bw-receipts-"));

export async function startServer() {
  const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri("budgetwise_test"));
  const { default: createApp } = await import("../src/createApp.js");
  // Build indexes (e.g. the unique recurring index) before tests run
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
  const server = await new Promise((resolve) => {
    const s = createApp().listen(0, () => resolve(s));
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  return {
    url,
    client: () => makeClient(url),
    async stop() {
      await new Promise((r) => server.close(r));
      await mongoose.disconnect();
      await replSet.stop();
    },
  };
}

// fetch with a one-cookie jar: each client is a separate browser/device
export function makeClient(url) {
  let cookie = "";
  // a Buffer body is sent as-is (file uploads), anything else as JSON
  const call = async (method, path, body, headers = {}) => {
    const raw = Buffer.isBuffer(body);
    const res = await fetch(url + path, {
      method,
      headers: {
        "content-type": raw ? "application/octet-stream" : "application/json",
        cookie,
        ...headers,
      },
      body: raw ? body : body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    const type = res.headers.get("content-type") || "";
    const data = type.includes("json")
      ? await res.json()
      : await res.arrayBuffer();
    return { status: res.status, data, headers: res.headers };
  };
  return {
    get: (p) => call("GET", p),
    post: (p, b) => call("POST", p, b),
    patch: (p, b) => call("PATCH", p, b),
    put: (p, b) => call("PUT", p, b),
    del: (p, b) => call("DELETE", p, b),
    upload: (p, buf, headers) => call("PUT", p, buf, headers),
  };
}

let seq = 0;
// A fresh signed-up user; returns their client and credentials
export async function newUser(ctx, password = "Testuser1@") {
  const client = ctx.client();
  seq++;
  const email = `user${Date.now()}${seq}@example.com`;
  const phoneNumber = String(
    9000000000 + ((Date.now() + seq * 7919) % 999999999)
  );
  const r = await client.post("/signup", {
    firstName: "Test",
    lastName: "User",
    email,
    password,
    phoneNumber,
  });
  if (r.status !== 201)
    throw new Error(`signup failed: ${r.status} ${JSON.stringify(r.data)}`);
  return { client, email, password };
}

// Calendar days as "YYYY-MM-DD"
export const utcToday = () => new Date().toISOString().slice(0, 10);
export const istToday = () =>
  new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
export const daysFromUtcToday = (n) =>
  new Date(Date.now() + n * 86400e3).toISOString().slice(0, 10);
export const monthStart = () => utcToday().slice(0, 8) + "01";
