import express from "express";
import crypto from "node:crypto";
import validator from "validator";
import User from "../model/user.js";
import { publicError, errorStatus } from "../utils/errors.js";
import { newPasswordProblem, setNewPassword } from "../utils/passwords.js";
import { endAllSessions } from "../utils/sessions.js";
import { sendPasswordResetEmail } from "../utils/autoEmail/mailer.js";

const passwordResetRouter = express.Router();

const RESET_MINUTES = 30;
const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
// Same answer whether or not the email has an account (no account probing)
const SENT = "If an account exists for that email, we've sent a reset link.";
const appUrl = () =>
  (process.env.APP_URL || "http://localhost:1234").replace(/\/$/, "");

// Signup stores the normalized form (gmail dots removed); look up both
const emailVariants = (email) => {
  const lower = email.trim().toLowerCase();
  return [...new Set([validator.normalizeEmail(lower), lower])];
};

passwordResetRouter.post("/password/forgot", async (req, res) => {
  try {
    const { email } = req.body;
    if (typeof email !== "string" || !validator.isEmail(email.trim())) {
      return res.status(400).json({ message: "Enter a valid email address." });
    }
    const user = await User.findOne({ email: { $in: emailVariants(email) } });
    if (user) {
      const token = crypto.randomBytes(32).toString("hex");
      user.passwordResetTokenHash = sha256(token); // a new link replaces the old
      user.passwordResetExpires = new Date(Date.now() + RESET_MINUTES * 60e3);
      await user.save();
      const link = `${appUrl()}/reset-password?token=${token}`;
      if (process.env.NODE_ENV !== "production") {
        // Local development: email is usually switched off, so print the link
        console.log(`[DEV] Password reset link for ${user.email}: ${link}`);
      }
      try {
        await sendPasswordResetEmail(user.email, user.firstName, link);
      } catch (err) {
        // Don't reveal delivery problems (or the account) to the caller
        console.error("[RESET] email failed:", err.message);
      }
    }
    res.status(200).json({ message: SENT });
  } catch (error) {
    const message = publicError(error);
    res.status(errorStatus(error)).json({ message, error: message });
  }
});

passwordResetRouter.post("/password/reset", async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    const bad = (message) => res.status(400).json({ message, error: message });
    if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) {
      return bad("This reset link is invalid or has expired.");
    }
    const problem = newPasswordProblem(newPassword);
    if (problem) return bad(problem);

    const user = await User.findOne({
      passwordResetTokenHash: sha256(token),
      passwordResetExpires: { $gt: new Date() },
    }).select("+passwordHistory +passwordResetTokenHash +passwordResetExpires");
    if (!user) return bad("This reset link is invalid or has expired.");

    // Same rules as change password; also signs out every session and
    // clears the link (single use)
    const reused = await setNewPassword(user, newPassword);
    if (reused) return bad(reused);
    await user.save();
    await endAllSessions(user._id);
    res.status(200).json({
      message: "Password reset. Sign in with your new password.",
    });
  } catch (error) {
    const message = publicError(error);
    res.status(errorStatus(error)).json({ message, error: message });
  }
});

export default passwordResetRouter;
