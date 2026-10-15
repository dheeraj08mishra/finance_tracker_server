import "./config/timezone.js"; // must stay first: server dates run in UTC
import env from "dotenv";
import mongoose from "mongoose";
import connectDB from "./config/database.js";
import { startJobs } from "./utils/cron/jobs.js";
env.config();

// Scheduled jobs on their own (npm run worker). Run one of these and set
// RUN_JOBS=false on the API processes; even if several run, each job runs
// once per period (see jobs.js).
try {
  await connectDB();
} catch (err) {
  console.error("MongoDB connection error:", err);
  process.exit(1);
}
console.log("[WORKER] MongoDB connected");
const stopJobs = startJobs();

const shutdown = (signal) => {
  console.log(`[WORKER] ${signal} received, shutting down`);
  stopJobs();
  mongoose.disconnect().finally(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000).unref();
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
