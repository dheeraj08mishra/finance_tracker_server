import mongoose from "mongoose";
import validator from "validator";
import { isFutureDay, ALL_FREQUENCIES } from "../utils/dates.js";

const { Schema } = mongoose;
const transactionSchema = new Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    goalId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Goal",
      default: null,
    },
    isGoalTransaction: {
      type: Boolean,
      default: false,
    },
    // Set on transactions generated from (or that started) a recurring rule;
    // used to avoid creating the same occurrence twice
    recurringTransactionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "RecurringTransaction",
      default: null,
    },
    type: {
      type: String,
      required: [true, "Type of transaction is required"],
      enum: {
        values: ["income", "expense", "credit", "transfer"],
        message: "{VALUE} is not a valid type of transaction",
      },
    },
    amount: {
      type: Number,
      required: [true, "Amount is required"],
      min: [0, "Amount must be a positive number"],
    },
    category: {
      type: String,
      required: [true, "Category is required"],
      enum: {
        values: ["need", "want", "investment", "other", "Goal Excess", "goal"],
        message: "{VALUE} is not a valid category",
      },
    },
    date: {
      type: Date,
      required: [true, "Date is required"],
      default: Date.now,
      validate: [
        {
          validator: function (value) {
            return value instanceof Date && !isNaN(value.getTime());
          },
          message: "Invalid date format",
        },
        {
          // Compared against the latest "today" on Earth, so users ahead of
          // UTC (e.g. IST after midnight) can record their own today
          validator: (value) => !isFutureDay(value),
          message: "Date cannot be in the future",
        },
      ],
    },
    note: {
      type: String,
      trim: true,
      default: "",
      validate: {
        validator: (v) => validator.isLength(v, { max: 200 }),
        message: "Note must be at most 200 characters long",
      },
    },
    isRecurring: {
      type: Boolean,
      default: false,
    },
    frequency: {
      type: String,
      enum: {
        values: ["", ...ALL_FREQUENCIES],
        message: "{VALUE} is not a valid frequency",
      },
      default: "",
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

transactionSchema.index({ userId: 1, amount: 1, category: 1, date: -1 });
// One transaction per recurring rule per occurrence date
transactionSchema.index(
  { recurringTransactionId: 1, date: 1 },
  {
    unique: true,
    partialFilterExpression: { recurringTransactionId: { $type: "objectId" } },
  }
);

const Transaction = mongoose.model("Transaction", transactionSchema);

export default Transaction;
