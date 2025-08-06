import mongoose, { Schema } from "mongoose";

const goalSchema = new Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 500,
    },
    targetAmount: {
      type: Number,
      required: true,
      min: [0, "Target amount must be a positive number"],
    },
    currentAmount: {
      type: Number,
      default: 0,
      min: [0, "Current amount must be a positive number"],
    },
    startDate: {
      type: Date,
      required: true,
      default: Date.now,
      validate: {
        validator: function (value) {
          return value <= new Date();
        },
        message: "Start date cannot be in the future",
      },
    },
    isCompleted: {
      type: Boolean,
      default: false,
    },

    completedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

goalSchema.methods.checkGoalStatus = function () {
  if (this.currentAmount >= this.targetAmount) {
    this.isCompleted = true;
    this.completedAt = new Date();
  }
};

export default mongoose.model("Goal", goalSchema);
