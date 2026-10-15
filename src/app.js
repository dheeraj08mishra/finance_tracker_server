import "./config/timezone.js"; // must stay first: server dates run in UTC
import env from "dotenv";
import mongoose from "mongoose";
import connectDB from "./config/database.js";
import createApp from "./createApp.js";
env.config();

const PORT = process.env.PORT || 3000;

try {
  await connectDB();
} catch (err) {
  // Without a database nothing works: exit so pm2 restarts and alerts
  console.error("MongoDB connection error:", err);
  process.exit(1);
}
console.log("MongoDB connected successfully");
// Scheduled jobs run here unless a separate worker (npm run worker) does
// them: set RUN_JOBS=false on the API then
let stopJobs = () => {};
if (process.env.RUN_JOBS !== "false") {
  const { startJobs } = await import("./utils/cron/jobs.js");
  stopJobs = startJobs();
} else {
  console.log("Scheduled jobs are off here (RUN_JOBS=false): run the worker");
}

const server = createApp().listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});

// pm2 restart / deploys: finish in-flight requests, then close the DB
const shutdown = (signal) => {
  console.log(`${signal} received, shutting down`);
  stopJobs();
  server.close(() => mongoose.disconnect().finally(() => process.exit(0)));
  setTimeout(() => process.exit(1), 10000).unref();
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
