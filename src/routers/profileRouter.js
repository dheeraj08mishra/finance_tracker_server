import express from "express";
import { publicError, errorStatus } from "../utils/errors.js";
import userAuth from "../middleware/auth.js";
import User from "../model/user.js";
import validator from "validator";
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
    // The form sends every field; an empty photo/phone means "unchanged"
    const photo = req.body.photo === "" ? undefined : req.body.photo;
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
    if (photo !== undefined) {
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

export default profileRouter;
