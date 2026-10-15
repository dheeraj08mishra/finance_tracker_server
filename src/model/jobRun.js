import mongoose, { Schema } from "mongoose";

// One scheduled job for one period, e.g. "daily:2026-10-15" or
// "monthly:2026-09". Whoever creates the document runs the job; every
// other API/worker process skips it. Kept 90 days as a run log.
const jobRunSchema = new Schema({
  _id: { type: String },
  startedAt: { type: Date, required: true },
  finishedAt: { type: Date, default: null },
  host: { type: String, default: "" },
  result: { type: Schema.Types.Mixed, default: null },
  error: { type: String, default: null },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
});

export default mongoose.model("JobRun", jobRunSchema);
