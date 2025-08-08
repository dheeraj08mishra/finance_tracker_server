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
env.config();
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json()); // Middleware to parse JSON request bodies
app.use(cookieParser()); // Middleware to parse cookies
app.use(
  cors({
    origin: "http://localhost:1234", // Replace with your frontend URL
    credentials: true, // Allow credentials (cookies) to be sent
  })
);
app.use("/", authenticationRouter); // Authentication routes
app.use("/", profileRouter); // Profile routes
app.use("/", transactionRouter); // Transaction routes
app.use("/", filterRouter); // Filter routes
app.use("/recurring", recurringTransactionRouter); // Recurring transaction routes
app.use("/", feedbackRouter); // Feedback routes
app.use("/", tagRouter); // Tag extraction routes
app.use("/", goalRouter); // Goal management routes

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
