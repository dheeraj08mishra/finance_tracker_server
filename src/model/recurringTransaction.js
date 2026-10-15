import mongoose from "mongoose";
const { Schema } = mongoose;
import validator from "validator";
import { isFutureDay, ALL_FREQUENCIES } from "../utils/dates.js";

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
      enum: ALL_FREQUENCIES,
    },
    startDate: {
      type: Date,
      required: true,
      default: Date.now,
      validate: {
        validator: (value) => !isFutureDay(value),
        message: "Start date cannot be in the future",
      },
    },
    // Optional: no occurrences are created after this day
    endDate: {
      type: Date,
      default: null,
    },
    // Occurrence days the user chose to skip (no transaction is created)
    skipDates: {
      type: [Date],
      default: [],
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
        validator: (value) => !value || !isFutureDay(value),
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
