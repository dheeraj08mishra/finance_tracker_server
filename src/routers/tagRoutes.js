import { extractTags } from "../utils/tags/extractTags.js";
import express from "express";
import { normalizeTags } from "../utils/tags/normalizeTags.js";
import { publicError, errorStatus } from "../utils/errors.js";
import userAuth from "../middleware/auth.js";
import Transaction from "../model/transactions.js";

const tagRouter = express.Router();
tagRouter.post("/extractTags/:id", userAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;
    let txnDetails = await Transaction.findOne({ _id: id, userId: userId });
    if (!txnDetails) {
      return res.status(404).send({ error: "Transaction not found" });
    }
    const note = (txnDetails.note || "").trim();
    if (!note) {
      // Nothing to tag; always answer so the client doesn't hang
      return res
        .status(200)
        .send({ message: "No note to tag", data: txnDetails });
    }
    txnDetails.tags = await extractTags(note);
    await txnDetails.save();
    res.status(200).send({
      message: "Tags extracted and updated successfully",
      data: txnDetails,
    });
  } catch (error) {
    console.error("Error extracting tags:", error);
    res.status(500).send({ error: "Failed to extract tags" });
  }
});

tagRouter.post("/extractTags/UpdateAll/batch", userAuth, async (req, res) => {
  try {
    const userId = req.user._id;
    const transactions = await Transaction.find({
      userId,
      note: { $exists: true, $ne: "" },
    });

    if (!transactions || transactions.length === 0) {
      return res
        .status(404)
        .send({ error: "No transactions with notes found" });
    }

    // At most 5 OpenAI calls at a time
    const tagOne = async (txn) => {
      try {
        if (!txn.note || txn.note.trim().length < 5) return null;
        if (txn.tags && txn.tags.length > 0) {
          return { id: txn._id, status: "skipped" };
        }
        txn.tags = await extractTags(txn.note);
        await txn.save();
        return { id: txn._id, status: "success" };
      } catch (err) {
        console.error(`Tag extraction failed for txn=${txn._id}:`, err);
        return {
          id: txn._id,
          status: "failed",
          error: "Tag extraction failed",
        };
      }
    };
    const results = [];
    for (let i = 0; i < transactions.length; i += 5) {
      results.push(
        ...(await Promise.allSettled(transactions.slice(i, i + 5).map(tagOne)))
      );
    }
    const successful = results.filter(
      (r) => r.status === "fulfilled" && r.value?.status === "success"
    );
    const failed = results.filter(
      (r) => r.status === "fulfilled" && r.value?.status === "failed"
    );

    res.status(200).send({
      message: `Tags processed. Success: ${successful.length}, Failed: ${failed.length}`,
      summary: {
        updated: successful.map((r) => r.value.id),
        failed: failed.map((r) => ({ id: r.value.id, error: r.value.error })),
      },
    });
  } catch (error) {
    console.error("Error in batch tag extraction:", error);
    res.status(500).send({ error: "Batch tag extraction failed" });
  }
});

// The user's tags, A-Z (one distinct query, no full scan into memory)
tagRouter.get("/allTags", userAuth, async (req, res) => {
  try {
    const tags = await Transaction.distinct("tags", { userId: req.user._id });
    res.status(200).send({
      message: "Tags fetched successfully",
      data: tags.filter(Boolean).sort((a, b) => a.localeCompare(b)),
    });
  } catch (error) {
    console.error("Error fetching tags:", error);
    return res.status(500).send({ error: "Failed to fetch tags" });
  }
});

// Set a transaction's tags. Allowed for any month: tags are labels, not
// money, so past months (otherwise read-only) can still be organised.
tagRouter.patch("/user/transaction/:id/tags", userAuth, async (req, res) => {
  try {
    const { tags, error } = normalizeTags(req.body.tags);
    if (error) return res.status(400).send({ message: error, error });
    const txn = await Transaction.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      { tags },
      { new: true, runValidators: true }
    );
    if (!txn) {
      return res.status(404).send({ message: "Transaction not found" });
    }
    res.status(200).send({ message: "Tags updated", data: txn });
  } catch (error) {
    const message = publicError(error);
    res.status(errorStatus(error)).send({ message, error: message });
  }
});

export default tagRouter;
