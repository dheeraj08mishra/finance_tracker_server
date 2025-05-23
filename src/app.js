import express from "express";
import env from "dotenv";
import connectDB from "./config/database.js";
import User from "./model/user.js";

env.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json()); // Middleware to parse JSON request bodies

// db connection

connectDB()
  .then(() => {
    console.log("MongoDB connected successfully");
    app.listen(PORT, () => {
      console.log(`Server is running on http://localhost:${PORT}`);
    });

    // Example of creating a new user
    const newUser = new User({
      firstName: "John",
      lastName: "Doe",
      email: "johndoe@gmail.com",
      password: "password123",
      phoneNumber: "1234567890",
      photo: "https://example.com/photo.jpg",
    });

    newUser
      .save()
      .then(() => {
        console.log("User created successfully");
      })
      .catch((err) => {
        console.error("Error creating user:", err);
      });
  })
  .catch((err) => {
    console.error("MongoDB connection error:", err);
  });
