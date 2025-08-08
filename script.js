import mongoose from "mongoose";
import { manualRecurringSync } from "./manualRecurringTransaction.js";
import dotenv from "dotenv";
dotenv.config();

mongoose.connect(process.env.MONGODB_URI);

manualRecurringSync()
  .then(() => {
    console.log("Manual recurring sync completed.");
    mongoose.disconnect();
  })
  .catch((err) => {
    console.error("Manual recurring sync failed:", err);
    mongoose.disconnect();
  });
