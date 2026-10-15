import express from "express";
import userAuth from "../middleware/auth.js";
import User from "../model/user.js";
import { publicError, errorStatus } from "../utils/errors.js";
import { parseAmount, MAX_AMOUNT } from "../utils/money.js";
import { BUDGET_CATEGORIES, budgetStatus } from "../utils/budgets.js";

const budgetRouter = express.Router();

// ?year=2026&month=10 (1-12); defaults to the current month
const pickMonth = (query) => {
  const now = new Date();
  const year = Number(query.year ?? now.getUTCFullYear());
  const month = Number(query.month ?? now.getUTCMonth() + 1);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return null;
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  return { year, month };
};

budgetRouter.get("/budgets", userAuth, async (req, res) => {
  try {
    const when = pickMonth(req.query);
    if (!when)
      return res.status(400).json({ message: "Invalid month or year" });
    res.json({
      ...when,
      data: await budgetStatus(req.user, when.year, when.month),
    });
  } catch (error) {
    res.status(errorStatus(error)).json({ message: publicError(error) });
  }
});

// { need: 15000, want: 8000, investment: null, other: "" } -> null clears
budgetRouter.put("/budgets", userAuth, async (req, res) => {
  try {
    const body = req.body || {};
    const unknown = Object.keys(body).filter(
      (k) => !BUDGET_CATEGORIES.includes(k)
    );
    if (unknown.length) {
      return res
        .status(400)
        .json({ message: `Unknown categories: ${unknown.join(", ")}` });
    }
    const update = {};
    for (const category of Object.keys(body)) {
      const value = body[category];
      if (value === null || value === "") {
        update[`budgets.${category}`] = null;
        continue;
      }
      const amount = parseAmount(value);
      if (amount === null) {
        return res.status(400).json({
          message: `Budget for ${category} must be a positive number up to ${MAX_AMOUNT}`,
        });
      }
      update[`budgets.${category}`] = amount;
    }
    const user = await User.findByIdAndUpdate(req.user._id, update, {
      new: true,
      runValidators: true,
    });
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth() + 1;
    res.json({
      message: "Budgets saved",
      year,
      month,
      data: await budgetStatus(user, year, month),
    });
  } catch (error) {
    res.status(errorStatus(error)).json({ message: publicError(error) });
  }
});

export default budgetRouter;
