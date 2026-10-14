// CLI: create all due recurring transactions for every user.
// Usage: node script.js
import "./src/config/timezone.js";
import mongoose from "mongoose";
import dotenv from "dotenv";
import { processDueRecurring } from "./src/utils/cron/recurringEngine.js";
dotenv.config();

await mongoose.connect(process.env.MONGODB_URI);
try {
  const { rules, created } = await processDueRecurring();
  console.log(`Recurring sync completed: ${rules} rule(s), ${created} created.`);
} catch (err) {
  console.error("Recurring sync failed:", err);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
