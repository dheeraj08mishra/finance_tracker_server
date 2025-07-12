import mongoose from "mongoose";
import validator from "validator";

const { Schema } = mongoose;
const transactionSchema = new Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    type: {
      type: String,
      required: [true, "Type of transaction is required"],
      enum: {
        values: ["income", "expense"],
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
        values: ["need", "want", "investment", "other"],
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
            const now = new Date();
            const valueDate = new Date(
              Date.UTC(
                value.getUTCFullYear(),
                value.getUTCMonth(),
                value.getUTCDate()
              )
            );
            const todayUTC = new Date(
              Date.UTC(
                now.getUTCFullYear(),
                now.getUTCMonth(),
                now.getUTCDate()
              )
            );
            return valueDate <= todayUTC;
          },
          message: "Date cannot be in the future",
        },
        {
          validator: function (value) {
            return value instanceof Date && !isNaN(value.getTime());
          },
          message: "Invalid date format",
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
        values: ["", "minutely", "daily", "weekly", "monthly", "yearly"],
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
transactionSchema.index({ userId: 1, date: -1, amount: 1 });

const Transaction = mongoose.model("Transaction", transactionSchema);

export default Transaction;
