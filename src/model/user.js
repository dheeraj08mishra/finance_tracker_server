import mongoose from "mongoose";
import validator from "validator";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
const { Schema } = mongoose;

// Old accounts were given this placeholder, which no longer exists.
// Treat it (and empty values) as "no photo".
const DEAD_DEFAULT_PHOTO = "https://s3.amazonaws.com/37assets/svn/765-default-avatar.png";
const normalizePhoto = (v) => (!v || v === DEAD_DEFAULT_PHOTO ? null : v);

const userSchema = new Schema(
  {
    firstName: {
      type: String,
      required: [true, "First name is required"],
      minLength: [3, "First name must be at least 3 characters"],
      maxLength: [20, "First name must be at most 20 characters"],
      lowercase: true,
      trim: true,
      validate: {
        validator: (v) => validator.isAlpha(v, "en-US", { ignore: " " }),
        message: "First name must contain only letters and spaces",
      },
    },
    lastName: {
      type: String,
      required: [true, "Last name is required"],
      trim: true,
      lowercase: true,
      validate: {
        validator: (v) => validator.isAlpha(v, "en-US", { ignore: " " }),
        message: "Last name must contain only letters and spaces",
      },
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      lowercase: true,
      trim: true,
      validate: {
        validator: validator.isEmail,
        message: (props) => `${props.value} is not a valid email!`,
      },
    },
    gender: {
      type: String,
      lowercase: true,
      trim: true,
      enum: {
        values: ["male", "female", "other"],
        message: "{VALUE} is not supported",
      },
    },
    password: {
      type: String,
      required: [true, "Password is required"],
      trim: true,
      validate: {
        validator: (v) =>
          validator.isStrongPassword(v, {
            minLength: 8,
            minLowercase: 1,
            minUppercase: 1,
            minNumbers: 1,
            minSymbols: 1,
          }),
        message:
          "Password must be at least 8 characters with upper, lower, number and symbol.",
      },
    },
    phoneNumber: {
      type: String,
      required: [true, "Phone number is required"],
      trim: true,
      validate: {
        validator: (v) =>
          validator.isMobilePhone(v, "any", { strictMode: false }),
        message: (props) => `${props.value} is not a valid phone number!`,
      },
    },
    // Bumped on password change; tokens carrying an older version are
    // rejected (see auth middleware), which signs out every other session
    tokenVersion: {
      type: Number,
      default: 0,
    },
    passwordChangedAt: {
      type: Date,
      default: null,
    },
    // Hashes of recent previous passwords (newest first), so they can't be
    // reused. Never sent to clients.
    passwordHistory: {
      type: [String],
      default: [],
      select: false,
    },
    // No photo by default: the app shows the user's initials
    photo: {
      type: String,
      default: null,
      get: normalizePhoto,
      validate: {
        validator: (v) => !v || validator.isURL(v),
        message: (props) => `${props.value} is not a valid URL!`,
      },
    },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform: function (doc, ret) {
        delete ret.password;
        delete ret.passwordHistory;
        ret.photo = normalizePhoto(ret.photo);
        delete ret.passwordChangedAt;
        delete ret.tokenVersion;
        delete ret.__v;
        return ret;
      },
    },
    toObject: { virtuals: true },
  }
);

userSchema.pre("save", async function (next) {
  if (this.isModified("password")) {
    this.password = await bcrypt.hash(this.password, 10);
  }
  next();
});

userSchema.methods.getJWT = function () {
  if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET not set");
  return jwt.sign({ userId: this._id, tv: this.tokenVersion || 0 }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRATION || "1d",
  });
};

// Compare password
userSchema.methods.comparePassword = async function (password) {
  return await bcrypt.compare(password, this.password);
};

// Virtual for full name
userSchema.virtual("fullName").get(function () {
  return `${this.firstName} ${this.lastName}`;
});

// Indexes for uniqueness
userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ phoneNumber: 1 }, { unique: true });

const User = mongoose.model("User", userSchema);
export default User;
