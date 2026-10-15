import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();

// Throws on failure: the caller decides (app.js exits so pm2 restarts it)
const connectDB = () =>
  mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });

export default connectDB;
