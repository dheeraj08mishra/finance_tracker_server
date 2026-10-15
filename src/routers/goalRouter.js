import express from "express";
import { publicError, errorStatus } from "../utils/errors.js";
import userAuth from "../middleware/auth.js";
import Transaction from "../model/transactions.js";
import Goal from "../model/goal.js";
import mongoose from "mongoose";
import { toDayString } from "../utils/dates.js";
const goalRouter = express.Router();

goalRouter.post("/goal/create", userAuth, async (req, res) => {
  try {
    let { title, description, targetAmount, startDate, currentAmount } =
      req.body;

    if (!title || !targetAmount) {
      return res
        .status(400)
        .json({ error: "Title and target amount required" });
    }
    if (typeof targetAmount !== "number" || targetAmount < 0) {
      return res
        .status(400)
        .json({ error: "Target amount must be a positive number" });
    }
    if (!startDate) {
      startDate = new Date().toISOString();
    }
    if (
      currentAmount &&
      (typeof currentAmount !== "number" || currentAmount < 0)
    ) {
      return res
        .status(400)
        .json({ error: "Current amount must be a positive number" });
    }
    if (startDate && new Date(startDate) > new Date()) {
      return res
        .status(400)
        .json({ error: "Start date cannot be in the future" });
    }
    const goal = new Goal({
      userId: req.user._id,
      title,
      description: description || "",
      targetAmount,
      currentAmount: currentAmount || 0,
      startDate: new Date(startDate),
    });

    await goal.save();
    res.status(201).json({ message: "Goal created successfully", goal });
  } catch (error) {
    res
      .status(errorStatus(error))
      .json({ error: "Something went wrong", details: publicError(error) });
  }
});

goalRouter.get("/goal/list", userAuth, async (req, res) => {
  try {
    const goals = await Goal.find({ userId: req.user._id }).sort({
      createdAt: -1,
    });

    if (!goals || goals.length === 0) {
      return res.status(200).json({ message: "No goals found" });
    }
    res.status(200).json({ message: "Goals retrieved successfully", goals });
  } catch (error) {
    res
      .status(errorStatus(error))
      .json({ error: "Something went wrong", details: publicError(error) });
  }
});

goalRouter.patch("/goal/update/:id", userAuth, async (req, res) => {
  try {
    const goalId = req.params.id;
    const { addAmount } = req.body;
    if (
      typeof addAmount !== "number" ||
      !Number.isFinite(addAmount) ||
      addAmount <= 0
    ) {
      return res
        .status(400)
        .json({ error: "amount must be a positive number" });
    }

    // Commits on success, rolls back and ends the session on any error
    const result = await mongoose.connection.transaction(async (session) => {
      const goal = await Goal.findOne({
        _id: goalId,
        userId: req.user._id,
      }).session(session);
      if (!goal) return { status: 404, body: { error: "Goal not found" } };
      if (goal.currentAmount >= goal.targetAmount) {
        return { status: 400, body: { error: "Goal is already completed" } };
      }

      // Only what is still needed is taken; the rest stays with the user
      const contribution = Math.min(
        addAmount,
        goal.targetAmount - goal.currentAmount
      );
      goal.currentAmount += contribution;
      goal.checkGoalStatus();

      await Transaction.create(
        [
          {
            userId: req.user._id,
            type: "expense",
            amount: contribution,
            category: "goal",
            note: `Contribution to goal ${goal.title}`,
            tags: ["goal", "savings"],
            date: toDayString(new Date()),
            goalId,
            isGoalTransaction: true,
          },
        ],
        { session }
      );
      await goal.save({ session });

      const excessAmount = addAmount - contribution;
      return {
        status: 200,
        body: {
          message:
            excessAmount > 0
              ? `Goal reached! Only ₹${contribution} was needed, so ₹${excessAmount} was not added.`
              : "Goal updated successfully",
          goal,
          contribution,
          excessAmount,
        },
      };
    });
    res.status(result.status).json(result.body);
  } catch (error) {
    res
      .status(errorStatus(error))
      .json({ error: "Something went wrong", details: publicError(error) });
  }
});

goalRouter.delete("/goal/delete/:id", userAuth, async (req, res) => {
  try {
    const goalID = req.params.id;
    const goal = await Goal.findOneAndDelete({
      _id: goalID,
      userId: req.user._id,
    });
    if (!goal) {
      return res.status(404).json({ error: "Goal not found" });
    }
    res.status(200).json({ message: "Goal deleted successfully", goal });
  } catch (error) {
    res
      .status(errorStatus(error))
      .json({ error: "Something went wrong", details: publicError(error) });
  }
});

export default goalRouter;
