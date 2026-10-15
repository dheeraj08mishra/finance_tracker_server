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
await import("./utils/cron/processRecurringTransaction.js");

const server = createApp().listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});

// pm2 restart / deploys: finish in-flight requests, then close the DB
const shutdown = (signal) => {
  console.log(`${signal} received, shutting down`);
  server.close(() => mongoose.disconnect().finally(() => process.exit(0)));
  setTimeout(() => process.exit(1), 10000).unref();
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
