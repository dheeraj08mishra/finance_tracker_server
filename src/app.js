import express from "express";
import env from "dotenv";
import connectDB from "./config/database.js";
import cookieParser from "cookie-parser";
import cors from "cors";
import authenticationRouter from "./routers/authenticationRouter.js";
import profileRouter from "./routers/profileRouter.js";
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

app.use(cookieParser()); // Middleware to parse cookies
app.use("/", authenticationRouter); // Authentication routes
app.use("/", profileRouter); // Profile routes
connectDB()
  .then(() => {
    console.log("MongoDB connected successfully");
    app.listen(PORT, () => {
      console.log(`Server is running on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error("MongoDB connection error:", err);
  });
