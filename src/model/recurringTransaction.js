import mongoose from "mongoose";
const { Schema } = mongoose;

const recurringTransactionSchema = new Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    type: {
      type: String,
      required: true,
      enum: ["income", "expense"],
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    category: {
      type: String,
      required: true,
      enum: ["need", "want", "investment", "other"],
    },
    note: {
      type: String,
      trim: true,
      default: "",
      maxlength: 200,
    },
    frequency: {
      type: String,
      required: true,
      enum: ["minutely", "daily", "weekly", "monthly", "yearly"],
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
    isActive: {
      type: Boolean,
      default: true,
    },
    nextOccurrence: {
      type: Date,
      required: false,
    },
    lastOccurrence: {
      type: Date,
      default: null,
      validate: {
        validator: function (value) {
          if (!value) return true;
          return value <= new Date();
        },
        message: "Last occurrence cannot be in the future",
      },
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    parentTransactionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Transaction",
      default: null,
    },
    tags: {
      type: [String],
      default: [],
      validate: {
        validator: (v) =>
          v.every((tag) => validator.isLength(tag, { max: 20 })),
        message: "Each tag must be at most 20 characters long",
      },
    },
  },
  {
    timestamps: true,
  }
);

const RecurringTransaction = mongoose.model(
  "RecurringTransaction",
  recurringTransactionSchema
);
export default RecurringTransaction;
