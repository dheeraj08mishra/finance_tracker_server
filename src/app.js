import "./config/timezone.js"; // must stay first: server dates run in UTC
import express from "express";
import env from "dotenv";
import connectDB from "./config/database.js";
import cookieParser from "cookie-parser";
import cors from "cors";
import authenticationRouter from "./routers/authenticationRouter.js";
import profileRouter from "./routers/profileRouter.js";
import transactionRouter from "./routers/transactionRouter.js";
import filterRouter from "./routers/filterRouter.js";
import recurringTransactionRouter from "./routers/recurringTransactionRouter.js";
import feedbackRouter from "./routers/feedbackRouter.js";
import tagRouter from "./routers/tagRoutes.js";
import goalRouter from "./routers/goalRouter.js";
import manualUpdateRecurringRouter from "./routers/manualUpdateRecurring.js";
import insightRouter from "./routers/insight.js";
import helmet from "helmet";
import { apiLimiter, authLimiter, aiLimiter } from "./utils/security.js";
env.config();
const app = express();
const PORT = process.env.PORT || 3000;

// Behind nginx, trust one proxy hop so rate limits see the real client IP
if (process.env.TRUST_PROXY) {
  app.set("trust proxy", Number(process.env.TRUST_PROXY));
}
app.disable("x-powered-by");
app.use(helmet()); // Security headers
app.use(apiLimiter);
app.use(express.json({ limit: "20kb" })); // Middleware to parse JSON request bodies
app.use(cookieParser()); // Middleware to parse cookies
app.use(
  cors({
    origin: process.env.CLIENT_ORIGIN || "http://localhost:1234", // frontend URL
    credentials: true, // Allow credentials (cookies) to be sent
  })
);
app.use(["/login", "/signup"], authLimiter);
app.use("/extractTags", aiLimiter);
app.use("/", authenticationRouter); // Authentication routes
app.use("/", profileRouter); // Profile routes
app.use("/", transactionRouter); // Transaction routes
app.use("/", filterRouter); // Filter routes
app.use("/recurring", recurringTransactionRouter); // Recurring transaction routes
app.use("/", feedbackRouter); // Feedback routes
app.use("/", tagRouter); // Tag extraction routes
app.use("/", goalRouter); // Goal management routes
app.use("/", manualUpdateRecurringRouter); // Manual update for recurring transactions
app.use("/insights", insightRouter); // Insight routes

connectDB()
  .then(() => {
    console.log("MongoDB connected successfully");
    import("./utils/cron/processRecurringTransaction.js");
    app.listen(PORT, () => {
      console.log(`Server is running on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error("MongoDB connection error:", err);
  });
