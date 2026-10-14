import express from "express";
import { publicError, errorStatus } from "../utils/errors.js";
import userAuth from "../middleware/auth.js";
import User from "../model/user.js";
import validator from "validator";
import { setAuthCookie } from "../utils/security.js";
import bcrypt from "bcrypt";

// How many recent passwords (including the current one) can't be reused
const PASSWORD_HISTORY = 3;
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
    for (const [field, value] of [["First name", firstName], ["Last name", lastName]]) {
      if (value === undefined) continue;
      if (typeof value !== "string" || !validator.isLength(value.trim(), { min: 3, max: 20 })) {
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
        !validator.isURL(photo, { protocols: ["https"], require_protocol: true })
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

    if (typeof currentPassword !== "string" || typeof newPassword !== "string") {
      return bad("Current and new password are required.");
    }
    if (!validator.isStrongPassword(newPassword)) {
      return bad(
        "New password must be at least 8 characters with upper, lower, number and symbol."
      );
    }
    // The schema trims passwords, which would silently change this one
    if (newPassword !== newPassword.trim()) {
      return bad("New password can't start or end with a space.");
    }

    // includes the hash; history is select:false so ask for it
    const user = await User.findById(req.user._id).select("+passwordHistory");
    // 403, not 401: the session is fine, the typed password isn't (a 401
    // would make the app treat this as an expired session and sign out)
    if (!(await user.comparePassword(currentPassword))) {
      return bad("Current password is incorrect.", 403);
    }
    // No reuse of the last PASSWORD_HISTORY passwords (current one included)
    const recentHashes = [user.password, ...(user.passwordHistory || [])].slice(0, PASSWORD_HISTORY);
    for (const hash of recentHashes) {
      if (await bcrypt.compare(newPassword, hash)) {
        return bad(`You can't reuse any of your last ${PASSWORD_HISTORY} passwords.`);
      }
    }

    // Keep the outgoing hash so it counts as "recent" from now on
    user.passwordHistory = recentHashes.slice(0, PASSWORD_HISTORY - 1);
    user.password = newPassword; // hashed by the pre-save hook
    user.passwordChangedAt = new Date();
    user.tokenVersion = (user.tokenVersion || 0) + 1; // invalidates all old tokens
    await user.save();

    setAuthCookie(res, user.getJWT());
    res.status(200).json({
      message: "Password changed. Other devices have been signed out.",
    });
  } catch (error) {
    const message = publicError(error);
    res.status(errorStatus(error)).json({ message, error: message });
  }
});

export default profileRouter;
