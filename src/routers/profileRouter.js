import express from "express";
import { publicError, errorStatus } from "../utils/errors.js";
import userAuth from "../middleware/auth.js";
import User from "../model/user.js";
import validator from "validator";
import { newPasswordProblem, setNewPassword } from "../utils/passwords.js";
import { USER_FREQUENCIES } from "../utils/dates.js";
import mongoose from "mongoose";
import Session from "../model/session.js";
import { startSession, endAllSessions } from "../utils/sessions.js";
import { clearAuthCookie } from "../utils/security.js";
import Transaction from "../model/transactions.js";
import RecurringTransaction from "../model/recurringTransaction.js";
import Goal from "../model/goal.js";
import Feedback from "../model/feedback.js";
import { removeUserReceipts } from "../utils/receiptStorage.js";
const profileRouter = express.Router();

profileRouter.post("/user/profile", userAuth, async (req, res) => {
  try {
    const validatedUser = req.user;
    const { email } = req.body;
    if (validatedUser.email !== email) {
      return res.status(403).json({ message: "Forbidden: Access denied" });
    }

    const userFind = await User.findOne({ email: email }).select("-password");
    if (!userFind) {
      return res.status(404).json({ message: "User not found" });
    }
    res
      .status(200)
      .json({ message: `${userFind.fullName} profile`, user: userFind });
  } catch (error) {
    res
      .status(errorStatus(error))
      .json({ error: "Something went wrong", details: publicError(error) });
  }
});

profileRouter.patch("/user/profile/update", userAuth, async (req, res) => {
  try {
    const { firstName, lastName, email, gender } = req.body;
    // The form sends every field. Empty photo = remove it (initials are shown);
    // empty phone = unchanged (a phone number is required)
    const photo = req.body.photo;
    const phoneNumber =
      req.body.phoneNumber === "" ? undefined : req.body.phoneNumber;
    const updateFields = {};
    const bad = (message) => res.status(400).json({ message, error: message });

    // Email can't be changed here; if sent it must be the user's own
    if (email !== undefined && email !== req.user.email) {
      return res.status(403).json({ message: "Forbidden: Access denied" });
    }

    // Every field is optional: validate only what was sent
    for (const [field, value] of [
      ["First name", firstName],
      ["Last name", lastName],
    ]) {
      if (value === undefined) continue;
      if (
        typeof value !== "string" ||
        !validator.isLength(value.trim(), { min: 3, max: 20 })
      ) {
        return bad(`${field} must be between 3 and 20 characters`);
      }
    }
    if (firstName !== undefined) updateFields.firstName = firstName.trim();
    if (lastName !== undefined) updateFields.lastName = lastName.trim();

    if (gender !== undefined) {
      if (typeof gender !== "string") return bad("Invalid gender");
      updateFields.gender = gender.toLowerCase();
    }
    if (photo === "" || photo === null) {
      updateFields.photo = null;
    } else if (photo !== undefined) {
      // https image links only (no javascript:, data: or plain http)
      if (
        typeof photo !== "string" ||
        !validator.isURL(photo, {
          protocols: ["https"],
          require_protocol: true,
        })
      ) {
        return bad("Photo must be an https:// link");
      }
      updateFields.photo = photo;
    }

    if (phoneNumber !== undefined) {
      if (
        typeof phoneNumber !== "string" ||
        !/^\d{10}$/.test(phoneNumber) ||
        !validator.isMobilePhone(phoneNumber, "any", { strictMode: false })
      ) {
        return bad("Phone number must be exactly 10 digits");
      }
      const isPhoneExists = await User.findOne({
        phoneNumber: phoneNumber,
        _id: { $ne: req.user._id }, // Exclude current user!
      });
      if (isPhoneExists) {
        return bad("Phone number is already in use");
      }
      updateFields.phoneNumber = phoneNumber;
    }

    const updatedUser = await User.findOneAndUpdate(
      { _id: req.user._id },
      updateFields,
      { new: true, runValidators: true }
    ).select("-password");
    if (!updatedUser) {
      return res.status(404).json({ message: "User not found" });
    }
    res
      .status(200)
      .json({ message: "Profile updated successfully", user: updatedUser });
  } catch (error) {
    const message = publicError(error);
    res.status(errorStatus(error)).json({ message, error: message });
  }
});

// Change password. Signs out every other session (see auth middleware) and
// gives this device a fresh cookie so it stays signed in.
profileRouter.patch("/user/password", userAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const bad = (message, status = 400) =>
      res.status(status).json({ message, error: message });

    if (
      typeof currentPassword !== "string" ||
      typeof newPassword !== "string"
    ) {
      return bad("Current and new password are required.");
    }
    const problem = newPasswordProblem(newPassword);
    if (problem) return bad(problem);

    // includes the hash; history is select:false so ask for it
    const user = await User.findById(req.user._id).select("+passwordHistory");
    // 403, not 401: the session is fine, the typed password isn't (a 401
    // would make the app treat this as an expired session and sign out)
    if (!(await user.comparePassword(currentPassword))) {
      return bad("Current password is incorrect.", 403);
    }
    const reused = await setNewPassword(user, newPassword);
    if (reused) return bad(reused);
    await user.save();

    // other devices: signed out; this one: a fresh session
    await endAllSessions(user._id);
    await startSession(req, res, user);
    res.status(200).json({
      message: "Password changed. Other devices have been signed out.",
    });
  } catch (error) {
    const message = publicError(error);
    res.status(errorStatus(error)).json({ message, error: message });
  }
});

// Which emails to get: { budgetAlerts, monthlySummary, recurringReminders }
profileRouter.patch("/user/notifications", userAuth, async (req, res) => {
  try {
    const KINDS = ["budgetAlerts", "monthlySummary", "recurringReminders"];
    const body = req.body || {};
    const keys = Object.keys(body);
    if (
      !keys.length ||
      keys.some((k) => !KINDS.includes(k) || typeof body[k] !== "boolean")
    ) {
      return res.status(400).json({
        message: `Send true/false for any of: ${KINDS.join(", ")}`,
      });
    }
    const update = Object.fromEntries(
      keys.map((k) => [`notifications.${k}`, body[k]])
    );
    const user = await User.findByIdAndUpdate(req.user._id, update, {
      new: true,
    });
    res.json({
      message: "Email settings saved",
      notifications: user.notifications,
    });
  } catch (error) {
    const message = publicError(error);
    res.status(errorStatus(error)).json({ message, error: message });
  }
});

// Defaults for new transactions: { defaultCategory, defaultFrequency }
const PREFERENCES = {
  defaultCategory: ["need", "want", "investment", "other"],
  defaultFrequency: USER_FREQUENCIES,
};

profileRouter.patch("/user/preferences", userAuth, async (req, res) => {
  try {
    const body = req.body || {};
    const keys = Object.keys(body);
    const bad = keys.find((k) => !PREFERENCES[k]?.includes(body[k]));
    if (!keys.length || bad) {
      return res.status(400).json({
        message: bad
          ? `${bad} must be one of: ${(PREFERENCES[bad] || []).join(", ") || "(unknown setting)"}`
          : "Send defaultCategory and/or defaultFrequency",
      });
    }
    const update = Object.fromEntries(
      keys.map((k) => [`preferences.${k}`, body[k]])
    );
    const user = await User.findByIdAndUpdate(req.user._id, update, {
      new: true,
      runValidators: true,
    });
    res.json({ message: "Settings saved", preferences: user.preferences });
  } catch (error) {
    const message = publicError(error);
    res.status(errorStatus(error)).json({ message, error: message });
  }
});

// Where this account is signed in, newest activity first
profileRouter.get("/user/sessions", userAuth, async (req, res) => {
  try {
    const sessions = await Session.find({ userId: req.user._id })
      .sort({ lastSeenAt: -1 })
      .lean();
    res.json({
      data: sessions.map((s) => ({
        _id: s._id,
        device: s.device,
        ip: s.ip,
        signedInAt: s.createdAt,
        lastSeenAt: s.lastSeenAt,
        current: String(s._id) === String(req.sessionId),
      })),
      // signed in before sessions existed: not listed, can't be ended here
      currentListed: !!req.sessionId,
    });
  } catch (error) {
    const message = publicError(error);
    res.status(errorStatus(error)).json({ message, error: message });
  }
});

// Sign out one other device
profileRouter.delete("/user/sessions/:id", userAuth, async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ message: "Invalid session" });
    }
    if (id === String(req.sessionId)) {
      return res
        .status(400)
        .json({ message: "Use Sign out to sign out this device." });
    }
    const r = await Session.deleteOne({ _id: id, userId: req.user._id });
    if (!r.deletedCount) {
      return res.status(404).json({ message: "Session not found" });
    }
    res.json({ message: "That device was signed out." });
  } catch (error) {
    const message = publicError(error);
    res.status(errorStatus(error)).json({ message, error: message });
  }
});

// Sign out every device except this one
profileRouter.post(
  "/user/sessions/sign-out-others",
  userAuth,
  async (req, res) => {
    try {
      const r = await Session.deleteMany({
        userId: req.user._id,
        ...(req.sessionId && { _id: { $ne: req.sessionId } }),
      });
      res.json({
        message:
          r.deletedCount === 1
            ? "1 other device was signed out."
            : `${r.deletedCount} other devices were signed out.`,
        count: r.deletedCount,
      });
    } catch (error) {
      const message = publicError(error);
      res.status(errorStatus(error)).json({ message, error: message });
    }
  }
);

// Delete the account and everything in it. Needs the password again.
// (App stores require in-app account deletion; so does good practice.)
profileRouter.delete("/user/account", userAuth, async (req, res) => {
  try {
    const { password } = req.body || {};
    if (typeof password !== "string" || !password) {
      return res
        .status(400)
        .json({ message: "Enter your password to delete your account." });
    }
    const user = await User.findById(req.user._id);
    // 403, not 401: a 401 would read as an expired session in the app
    if (!(await user.comparePassword(password))) {
      return res.status(403).json({ message: "Password is incorrect." });
    }
    const userId = user._id;
    await mongoose.connection.transaction(async (session) => {
      await Transaction.deleteMany({ userId }, { session });
      await RecurringTransaction.deleteMany({ userId }, { session });
      await Goal.deleteMany({ userId }, { session });
      await Feedback.deleteMany({ UserId: userId }, { session });
      await Session.deleteMany({ userId }, { session });
      await User.deleteOne({ _id: userId }, { session });
    });
    // files last: the data is gone even if this step fails
    await removeUserReceipts(userId).catch((err) =>
      console.error("[ACCOUNT] receipt folder not removed:", err)
    );
    clearAuthCookie(res);
    res.json({ message: "Your account and all its data were deleted." });
  } catch (error) {
    const message = publicError(error);
    res.status(errorStatus(error)).json({ message, error: message });
  }
});

export default profileRouter;
