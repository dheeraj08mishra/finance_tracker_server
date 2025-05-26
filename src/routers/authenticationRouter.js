import express from "express";
import User from "../model/user.js";
const authenticationRouter = express.Router();
import validator from "validator";
import jwt from "jsonwebtoken";
import userAuth from "../middleware/auth.js";

authenticationRouter.post("/signup", async (req, res) => {
  try {
    const { firstName, lastName, email, password, phoneNumber } = req.body;

    if (!validator.isStrongPassword(password)) {
      return res.status(400).json({
        message:
          "Password must be at least 8 characters with upper, lower, number and symbol.",
      });
    }
    if (!validator.isEmail(email.trim().toLowerCase())) {
      return res.status(400).json({ message: "Invalid email format" });
    }
    if (!validator.isLength(firstName, { min: 3, max: 20 })) {
      return res.status(400).json({
        message: "First name must be between 3 and 20 characters",
      });
    }
    if (!validator.isLength(lastName, { min: 3, max: 20 })) {
      return res.status(400).json({
        message: "Last name must be between 3 and 20 characters",
      });
    }
    if (
      phoneNumber &&
      !validator.isMobilePhone(phoneNumber, "any", { strictMode: false })
    ) {
      return res.status(400).json({ message: "Invalid phone number format" });
    }
    if (phoneNumber && !validator.isLength(phoneNumber, { min: 10, max: 10 })) {
      return res
        .status(400)
        .json({ message: "Phone number must be exactly 10 digits" });
    }
    // Trim and normalize email
    email = validator.normalizeEmail(email.trim().toLowerCase());
    // Check if user already exists

    const existingUser = await User.findOne({ email: email });
    if (existingUser) {
      return res.status(400).json({ message: "User already exists" });
    }
    // Create new user
    const newUser = new User({
      firstName,
      lastName,
      email,
      phoneNumber,
      password,
    });

    await newUser.save(); /// save the new user to the database
    // Generate JWT token
    const token = newUser.getJWT();
    // Set cookie with token
    res.cookie("token", token, {
      httpOnly: true,
      maxAge: Number(process.env.COOKIES_AGE) || 24 * 60 * 60 * 1000, // Default to 1 day if not set
    });
    // Respond with success message and user data
    res.status(201).json({
      message: `Welcome ${firstName} ${lastName}, your account was created successfully`,
      user: {
        email: validator.normalizeEmail(newUser.email),
        firstName: newUser.firstName,
        lastName: newUser.lastName,
        phoneNumber: newUser.phoneNumber,
      },
    });
  } catch (error) {
    console.error("Error during signup:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

authenticationRouter.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!validator.isEmail(email.trim().toLowerCase())) {
      return res.status(400).json({ message: "Invalid email format" });
    }

    const user = await User.findOne({ email: email });
    console.log(user);
    if (!user) {
      return res.status(400).json({ message: "User not found" });
    }
    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      return res.status(400).json({ message: "Invalid Credential" });
    }
    const token = user.getJWT();
    res.cookie("token", token, {
      httpOnly: true,
      maxAge: Number(process.env.COOKIES_AGE) || 24 * 60 * 60 * 1000,
    });
    res.status(200).json({
      message: `Welcome back ${user.firstName} ${user.lastName}`,
      user: {
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        phoneNumber: user.phoneNumber,
        photo: user.photo,
        _id: user._id,
        fullName: user.fullName,
        age: user.age,
      },
    });
  } catch (error) {
    console.error("Error during login:", error);
    res.status(500).json({ message: "Error during login" });
  }
});

authenticationRouter.post("/logout", (req, res) => {
  try {
    res.clearCookie("token");
    res.status(200).json({ message: "Logged out successfully" });
  } catch (error) {
    console.error("Error during logout:", error);
    res.status(500).json({ message: "Error during logout" });
  }
});

authenticationRouter.get("/me", async (req, res) => {
  try {
    const token = req.cookies.token;
    if (!token) return res.status(401).json({ message: "Unauthorized" });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId);

    if (!user) return res.status(404).json({ message: "User not found" });

    res.status(200).json({
      user: {
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        phoneNumber: user.phoneNumber,
        photo: user.photo,
        _id: user._id,
        fullName: user.fullName,
        age: user.age,
      },
    });
  } catch (err) {
    console.error("Error in /me route:", err);
    res.status(401).json({ message: "Unauthorized" });
  }
});

export default authenticationRouter;
