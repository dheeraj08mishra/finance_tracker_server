import mongoose from "mongoose";
const { Schema } = mongoose;
import validator from "validator";
import bcrypt from "bcrypt";

const userSchema = new Schema(
  {
    firstName: {
      type: String,
      required: true,
      minLength: 3,
      maxLength: 20,
      trim: true,
    },
    lastName: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      unique: true,
    },
    password: {
      type: String,
      required: true,
      minLength: 6,
      maxLength: 20,
      trim: true,
    },
    phoneNumber: {
      type: String,
      required: true,
      trim: true,
    },
    photo: {
      default: "https://s3.amazonaws.com/37assets/svn/765-default-avatar.png",
      type: String,
    },
  },
  {
    timestamps: true,
  }
);

const User = mongoose.model("User_details", userSchema);
export default User;
