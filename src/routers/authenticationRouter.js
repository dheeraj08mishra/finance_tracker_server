import express from "express";
import User from "../model/user.js";
const authenticationRouter = express.Router();
import validator from "validator";

authenticationRouter.post("/signup", async (req, res) => {
  try {
    const {
      firstName,
      lastName,
      email,
      password,
      age,
      phoneNumber,
      photo,
      gender,
    } = req.body;

    // Validate password strength
    if (!validator.isStrongPassword(password)) {
      return res.status(400).json({
        message:
          "Password must be at least 8 characters with upper, lower, number and symbol.",
      });
    }
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
      age,
      phoneNumber,
      photo,
      gender,
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
        age: newUser.age,
        phoneNumber: newUser.phoneNumber,
        photo: newUser.photo,
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
    //compare password
    console.log(password);
    const isPasswordValid = await user.comparePassword(password);
    console.log(isPasswordValid);
    if (!isPasswordValid) {
      return res.status(400).json({ message: "Invalid Credential" });
    }
    const token = user.getJWT();
    // Set cookie with token
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

export default authenticationRouter;
