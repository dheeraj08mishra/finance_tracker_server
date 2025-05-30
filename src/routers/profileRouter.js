import express from "express";
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
      .status(500)
      .json({ error: "Something went wrong", details: error.message });
  }
});

profileRouter.patch("/user/profile/update", userAuth, async (req, res) => {
  try {
    const { firstName, lastName, age, phoneNumber, photo, email, gender } =
      req.body;
    const updateFields = {};

    const validatedUser = req.user;
    if (validatedUser.email !== email) {
      return res.status(403).json({ message: "Forbidden: Access denied" });
    }

    if (firstName !== undefined) updateFields.firstName = firstName;
    if (lastName !== undefined) updateFields.lastName = lastName;
    if (age !== undefined) updateFields.age = age;
    if (photo !== undefined) updateFields.photo = photo;
    if (gender !== undefined) updateFields.gender = gender.toLowerCase();

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

    if (phoneNumber !== undefined) {
      const isPhoneValid = validator.isMobilePhone(phoneNumber, "any", {
        strictMode: false,
      });
      if (!isPhoneValid) {
        return res.status(400).json({ message: "Invalid phone number format" });
      }
      const isPhoneExists = await User.findOne({
        phoneNumber: phoneNumber,
        _id: { $ne: req.user._id }, // Exclude current user!
      });
      if (isPhoneExists) {
        return res.status(400).json({ message: "Phone number already exist" });
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
    await updatedUser.save(); // Save the updated user to the database
    res
      .status(200)
      .json({ message: "Profile updated successfully", user: updatedUser });
  } catch (error) {
    res
      .status(500)
      .json({ error: "Something went wrong", details: error.message });
  }
});

export default profileRouter;
