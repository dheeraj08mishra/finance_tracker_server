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
