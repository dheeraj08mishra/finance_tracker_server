import express from "express";
import userAuth from "../middleware/auth.js";
import Transaction from "../model/transactions.js";
import Goal from "../model/goal.js";
import { extractTags } from "../utils/tags/extractTags.js";
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
      .status(500)
      .json({ error: "Something went wrong", details: error.message });
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
      .status(500)
      .json({ error: "Something went wrong", details: error.message });
  }
});

goalRouter.patch("/goal/update/:id", userAuth, async (req, res) => {
  const session = await Goal.startSession();
  session.startTransaction();
  try {
    const goalId = req.params.id;
    const { addAmount } = req.body;
    if (!addAmount || typeof addAmount !== "number" || addAmount < 0) {
      return res
        .status(400)
        .json({ error: "amount must be a positive number" });
    }
    const goal = await Goal.findOne({ _id: goalId, userId: req.user._id });
    if (!goal) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ error: "Goal not found" });
    }
    if (goal.isCompleted && goal.currentAmount >= goal.targetAmount) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: "Goal is already completed" });
    }
    goal.currentAmount += addAmount;
    let excessAmount = 0;
    if (goal.currentAmount > goal.targetAmount) {
      excessAmount = goal.currentAmount - goal.targetAmount;
      goal.currentAmount = goal.targetAmount;
    }
    const transaction = new Transaction({
      userId: req.user._id,
      type: "expense",
      amount: addAmount - excessAmount,
      category: "goal",
      note: `Contribution to goal ${goal.title}`,
      date: new Date(),
      goalId: goalId,
      isGoalTransaction: true,
    });

    const tags = await extractTags(transaction.note);
    transaction.tags = tags;

    await transaction.save({ session });

    goal.checkGoalStatus();
    await goal.save({ session });
    await session.commitTransaction();
    session.endSession();
    res.status(200).json({ message: "Goal updated successfully", goal });
  } catch (error) {
    res
      .status(500)
      .json({ error: "Something went wrong", details: error.message });
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
      .status(500)
      .json({ error: "Something went wrong", details: error.message });
  }
});

export default goalRouter;
