// Send monthly summaries by hand, e.g. to resend or to try it locally:
//   npm run send-summaries -- 2026-09
// Locally emails are printed to the console (EMAIL_DELIVERY=log).
import "./src/config/timezone.js";
import mongoose from "mongoose";
import dotenv from "dotenv";
import { sendMonthlySummaries } from "./src/utils/notifications.js";
dotenv.config();

const arg = process.argv[2] || "";
const m = arg.match(/^(\d{4})-(\d{2})$/);
if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) {
  console.error("Usage: npm run send-summaries -- YYYY-MM");
  process.exit(1);
}
await mongoose.connect(process.env.MONGODB_URI);
try {
  const r = await sendMonthlySummaries(Number(m[1]), Number(m[2]));
  console.log(`Summaries for ${arg}: ${r.sent} sent, ${r.skipped} skipped`);
} finally {
  await mongoose.disconnect();
}
