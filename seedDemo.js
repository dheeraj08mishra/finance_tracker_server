// Creates (or resets) a demo account with ~6 months of realistic data.
// Usage: MONGODB_URI=mongodb://127.0.0.1:27018/finance_tracker?replicaSet=testset node seedDemo.js
import mongoose from "mongoose";
import dotenv from "dotenv";
import User from "./src/model/user.js";
import Transaction from "./src/model/transactions.js";
import RecurringTransaction from "./src/model/recurringTransaction.js";
import Goal from "./src/model/goal.js";

dotenv.config();

const MONGO_URI = process.env.MONGODB_URI;
// Deletes and recreates the demo user's data — never point it at a remote DB.
if (!/^mongodb:\/\/(localhost|127\.0\.0\.1)[:/]/.test(MONGO_URI || "")) {
  console.error("Refusing to seed: MONGODB_URI must be a local database.");
  process.exit(1);
}

export const DEMO = {
  email: "demo@budgetwise.app",
  password: "Demo@1234",
  firstName: "demo",
  lastName: "user",
  phoneNumber: "9000000001",
  gender: "other",
};

// Noon UTC so the date is the same day in every timezone
const day = (y, m, d) => new Date(Date.UTC(y, m - 1, d, 12));

const MONTHS = [
  [2026, 5],
  [2026, 6],
  [2026, 7],
  [2026, 8],
  [2026, 9],
  [2026, 10],
];
const LAST_DAY_THIS_MONTH = 12; // keep current-month data in the past

// Small deterministic variation so months don't look identical
const vary = (base, seed) =>
  Math.round(base * (0.85 + ((seed * 37) % 30) / 100));

function monthTransactions(userId, y, m, i) {
  const cap = (d) =>
    y === 2026 && m === 10 ? Math.min(d, LAST_DAY_THIS_MONTH) : d;
  const t = (type, amount, category, d, note, tags, extra = {}) => ({
    userId,
    type,
    amount,
    category,
    date: day(y, m, cap(d)),
    note,
    tags,
    ...extra,
  });

  const list = [
    t("income", 85000, "other", 1, "Monthly salary", ["salary", "income"]),
    t("expense", 22000, "need", 2, "House rent", ["rent", "housing"], {
      isRecurring: true,
      frequency: "monthly",
    }),
    t(
      "expense",
      10000,
      "investment",
      5,
      "Mutual fund SIP",
      ["sip", "mutual fund"],
      { isRecurring: true, frequency: "monthly" }
    ),
    t(
      "expense",
      649,
      "want",
      7,
      "Netflix subscription",
      ["streaming", "subscription"],
      { isRecurring: true, frequency: "monthly" }
    ),
    t("expense", vary(3200, i + 1), "need", 4, "Groceries from BigBasket", [
      "groceries",
      "food",
    ]),
    t("expense", vary(2800, i + 2), "need", 11, "Weekly groceries", [
      "groceries",
      "food",
    ]),
    t("expense", vary(1850, i + 3), "need", 9, "Electricity bill", [
      "electricity",
      "utilities",
    ]),
    t("expense", 799, "need", 10, "Mobile and internet recharge", [
      "mobile",
      "internet",
    ]),
    t("expense", vary(1500, i + 4), "want", 8, "Dinner with friends", [
      "dining",
      "friends",
    ]),
    t("expense", vary(2200, i + 5), "need", 6, "Fuel and metro card", [
      "transport",
      "fuel",
    ]),
    t("expense", vary(2600, i + 6), "want", 12, "Clothes shopping", [
      "shopping",
      "clothes",
    ]),
  ];

  if (!(y === 2026 && m === 10)) {
    list.push(
      t("expense", vary(2400, i + 7), "need", 18, "Groceries restock", [
        "groceries",
        "food",
      ]),
      t("expense", vary(1200, i + 8), "want", 21, "Movie and snacks", [
        "movies",
        "entertainment",
      ]),
      t("expense", vary(900, i + 9), "need", 24, "Pharmacy", [
        "health",
        "medicine",
      ]),
      t("expense", vary(1800, i + 10), "want", 27, "Weekend food delivery", [
        "food delivery",
        "dining",
      ])
    );
  }
  if (m === 6) {
    list.push(
      t("income", 12000, "other", 20, "Freelance design project", [
        "freelance",
        "side income",
      ])
    );
  }
  if (m === 8) {
    // Spending spike — shows up in anomaly detection
    list.push(
      t("expense", 28000, "want", 14, "Goa trip flights and hotel", [
        "travel",
        "vacation",
      ]),
      t("expense", 9500, "want", 16, "Goa trip food and activities", [
        "travel",
        "vacation",
      ])
    );
  }
  if (m === 9) {
    list.push(
      t("income", 15000, "other", 25, "Festival bonus", ["bonus", "income"]),
      t("expense", 6500, "need", 13, "Car service", ["car", "maintenance"])
    );
  }
  return list;
}

async function seed() {
  await mongoose.connect(MONGO_URI);

  // Reset only the demo user's data
  const existing = await User.findOne({ email: DEMO.email });
  if (existing) {
    await Promise.all([
      Transaction.deleteMany({ userId: existing._id }),
      RecurringTransaction.deleteMany({ userId: existing._id }),
      Goal.deleteMany({ userId: existing._id }),
    ]);
    await existing.deleteOne();
  }

  const user = await User.create(DEMO); // password hashed by the pre-save hook
  const userId = user._id;

  const txns = MONTHS.flatMap(([y, m], i) =>
    monthTransactions(userId, y, m, i)
  );
  const saved = await Transaction.insertMany(txns);

  // Goals + their contribution transactions
  const goals = await Goal.insertMany([
    {
      userId,
      title: "Emergency Fund",
      description: "6 months of expenses",
      targetAmount: 300000,
      currentAmount: 0,
      startDate: day(2026, 5, 1),
    },
    {
      userId,
      title: "New Laptop",
      description: "MacBook for work",
      targetAmount: 120000,
      currentAmount: 0,
      startDate: day(2026, 6, 1),
    },
    {
      userId,
      title: "Goa Trip",
      description: "Beach vacation with friends",
      targetAmount: 40000,
      currentAmount: 0,
      startDate: day(2026, 5, 15),
    },
  ]);
  // Steady monthly saving, so the August trip stands out as the spike
  const contributions = [
    ...MONTHS.map(([y, m]) => [goals[0], 15000, y, m, 3]),
    ...MONTHS.map(([y, m]) => [goals[1], 8000, y, m, 11]),
    ...MONTHS.slice(0, 4).map(([y, m]) => [goals[2], 10000, y, m, 10]),
  ];
  await Transaction.insertMany(
    contributions.map(([g, amount, y, m, d]) => ({
      userId,
      type: "expense",
      amount,
      category: "goal",
      date: day(y, m, d),
      note: `Contribution to goal ${g.title}`,
      tags: ["goal", "savings"],
      goalId: g._id,
      isGoalTransaction: true,
    }))
  );
  for (const g of goals) {
    g.currentAmount = contributions
      .filter(([cg]) => cg._id.equals(g._id))
      .reduce((sum, [, amount]) => sum + amount, 0);
    g.checkGoalStatus();
    await g.save();
  }

  // Recurring rules, linked to their first transaction
  const firstOf = (note) =>
    saved.find((s) => s.note === note && s.date.getUTCMonth() === 4);
  const recurring = [
    ["House rent", 22000, "need", 2, ["rent", "housing"]],
    ["Mutual fund SIP", 10000, "investment", 5, ["sip", "mutual fund"]],
    ["Netflix subscription", 649, "want", 7, ["streaming", "subscription"]],
  ];
  await RecurringTransaction.insertMany(
    recurring.map(([note, amount, category, d, tags]) => ({
      userId,
      type: "expense",
      amount,
      category,
      note,
      tags,
      frequency: "monthly",
      startDate: day(2026, 5, d),
      lastOccurrence: day(2026, 10, d),
      nextOccurrence: day(2026, 11, d),
      isActive: true,
      createdBy: userId,
      updatedBy: userId,
      parentTransactionId: firstOf(note)._id,
    }))
  );

  const count = await Transaction.countDocuments({ userId });
  console.log(`Demo user ready: ${DEMO.email} / ${DEMO.password}`);
  console.log(
    `userId=${userId}  transactions=${count}  goals=${goals.length}  recurring=${recurring.length}`
  );
  await mongoose.disconnect();
}

seed().catch(async (e) => {
  console.error("Demo seed failed:", e);
  await mongoose.disconnect();
  process.exit(1);
});
