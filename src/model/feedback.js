import mongoose, { Schema } from "mongoose";

const feedbackSchema = new Schema(
  {
    UserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    feedbackText: {
      type: String,
      required: true,
      trim: true,
      maxlength: 500,
    },
    // Admin triage: new -> seen -> done, with a private note
    status: {
      type: String,
      enum: ["new", "seen", "done"],
      default: "new",
    },
    adminNote: {
      type: String,
      trim: true,
      maxlength: 500,
      default: "",
    },
    handledBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    handledAt: {
      type: Date,
      default: null,
    },
    feedbackType: {
      type: String,
      required: true,
      enum: ["bug", "feature", "suggestion", "other"],
      default: "other",
    },
  },
  {
    timestamps: true,
  }
);

const Feedback = mongoose.model("Feedback", feedbackSchema);
export default Feedback;
