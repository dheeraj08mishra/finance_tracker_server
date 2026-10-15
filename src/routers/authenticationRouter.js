import express from "express";
import User from "../model/user.js";
const authenticationRouter = express.Router();
import validator from "validator";
import jwt from "jsonwebtoken";
import {
  startSession,
  endSession,
  refreshSession,
  endSessionByRefreshToken,
  requestToken,
} from "../utils/sessions.js";
import { clearAuthCookie } from "../utils/security.js";
import userAuth from "../middleware/auth.js";

// Signup stores the normalized form (gmail dots removed); older records may be
// plain-lowercased, so look up both.
const emailVariants = (email) => {
  const lower = email.trim().toLowerCase();
  return [...new Set([validator.normalizeEmail(lower), lower])];
};

// Remember when the user last signed in (shown to admins). Best effort:
// a failure here must never block signing in.
const recordSignIn = (userId) =>
  User.updateOne({ _id: userId }, { lastLoginAt: new Date() }).catch(() => {});

authenticationRouter.post("/signup", async (req, res) => {
  try {
    const { firstName, lastName, password, phoneNumber } = req.body;
    const requiredStrings = [firstName, lastName, password, req.body.email];
    if (
      requiredStrings.some((v) => typeof v !== "string") ||
      (phoneNumber !== undefined && typeof phoneNumber !== "string")
    ) {
      return res.status(400).json({ message: "All fields are required." });
    }

    if (!validator.isStrongPassword(password)) {
      return res.status(400).json({
        message:
          "Password must be at least 8 characters with upper, lower, number and symbol.",
      });
    }
    let { email } = req.body;
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

    const existingUser = await User.findOne({
      email: { $in: emailVariants(req.body.email) },
    });
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
    // website: login cookie · mobile app: tokens in the response
    const { tokens } = await startSession(req, res, newUser);
    await recordSignIn(newUser._id);
    // Respond with success message and user data
    res.status(201).json({
      ...(tokens && { tokens }),
      message: `Welcome ${firstName} ${lastName}, your account was created successfully`,
      user: {
        email: validator.normalizeEmail(newUser.email),
        firstName: newUser.firstName,
        lastName: newUser.lastName,
        phoneNumber: newUser.phoneNumber,
        _id: newUser._id,
        fullName: newUser.fullName,
        role: newUser.role,
        notifications: newUser.notifications,
        preferences: newUser.preferences,
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
    if (
      typeof email !== "string" ||
      typeof password !== "string" ||
      !validator.isEmail(email.trim().toLowerCase())
    ) {
      return res.status(400).json({ message: "Invalid email or password" });
    }

    const user = await User.findOne({ email: { $in: emailVariants(email) } });
    // Same response for unknown email and wrong password, so attackers
    // can't discover which emails are registered
    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ message: "Invalid email or password" });
    }
    const { tokens } = await startSession(req, res, user);
    await recordSignIn(user._id);
    res.status(200).json({
      ...(tokens && { tokens }),
      message: `Welcome back ${user.firstName} ${user.lastName}`,
      user: {
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        phoneNumber: user.phoneNumber,
        photo: user.photo,
        _id: user._id,
        fullName: user.fullName,
        role: user.role,
        notifications: user.notifications,
        preferences: user.preferences,
        gender: user.gender,
        // age: user.age,
      },
    });
  } catch (error) {
    console.error("Error during login:", error);
    res.status(500).json({ message: "Error during login" });
  }
});

authenticationRouter.post("/logout", async (req, res) => {
  try {
    // Forget this device's session too (an invalid token just clears).
    // The app may send its refresh token, which works after the access
    // token has expired.
    await endSessionByRefreshToken(req.body?.refreshToken);
    try {
      const { sid } = jwt.verify(
        requestToken(req).token,
        process.env.JWT_SECRET
      );
      await endSession(sid);
    } catch {
      /* no or expired token: nothing to end */
    }
    clearAuthCookie(res);
    res.status(200).json({ message: "Logged out successfully" });
  } catch (error) {
    console.error("Error during logout:", error);
    res.status(500).json({ message: "Error during logout" });
  }
});

authenticationRouter.get("/me", userAuth, async (req, res) => {
  try {
    const user = req.user;
    res.status(200).json({
      user: {
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        phoneNumber: user.phoneNumber,
        photo: user.photo,
        _id: user._id,
        fullName: user.fullName,
        role: user.role,
        notifications: user.notifications,
        preferences: user.preferences,
        gender: user.gender,
        // age: user.age,
      },
    });
  } catch (err) {
    console.error("Error in /me route:", err);
    res.status(401).json({ message: "Unauthorized" });
  }
});

// Mobile app: new access + refresh tokens for the current refresh token
authenticationRouter.post("/auth/refresh", async (req, res) => {
  try {
    const r = await refreshSession(req.body?.refreshToken);
    if (r.error) return res.status(r.status).json({ message: r.error });
    res.json({ tokens: r.tokens });
  } catch (error) {
    console.error("Error during token refresh:", error);
    res.status(500).json({ message: "Couldn't refresh the session" });
  }
});

export default authenticationRouter;
