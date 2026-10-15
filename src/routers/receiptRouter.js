import express from "express";
import mongoose from "mongoose";
import userAuth from "../middleware/auth.js";
import Transaction from "../model/transactions.js";
import { publicError, errorStatus } from "../utils/errors.js";
import {
  MAX_RECEIPT_BYTES,
  sniff,
  putReceipt,
  streamReceipt,
  removeReceipt,
} from "../utils/receiptStorage.js";

// A photo or PDF attached to a transaction. The app sends the file itself
// as the request body (no multipart). Any month, like tags.
const receiptRouter = express.Router();

// The file as raw bytes, with a clear message when it is too big
const rawBody = express.raw({ type: () => true, limit: MAX_RECEIPT_BYTES });
const readFile = (req, res, next) =>
  rawBody(req, res, (err) => {
    if (!err) return next();
    res.status(err.type === "entity.too.large" ? 413 : 400).json({
      message:
        err.type === "entity.too.large"
          ? "Receipts can be up to 5 MB."
          : "Couldn't read the file.",
    });
  });

const fail = (res, error) => {
  const message = publicError(error);
  res.status(errorStatus(error)).json({ message, error: message });
};

// The signed-in user's transaction, or null (404 for anyone else's)
const ownTransaction = (req) =>
  mongoose.isValidObjectId(req.params.id)
    ? Transaction.findOne({ _id: req.params.id, userId: req.user._id })
    : null;

// Display name only: letters, digits, spaces, dots, dashes; short.
// The app sends it URL-encoded (headers can't carry Hindi or emoji).
const cleanName = (s) => {
  let name = String(s || "");
  try {
    name = decodeURIComponent(name);
  } catch {
    /* not encoded: use as is */
  }
  return (
    name
      .replace(/[^\p{L}\p{M}\p{N} ._-]/gu, "")
      .trim()
      .slice(0, 100) || "receipt"
  );
};

receiptRouter.put(
  "/user/transaction/:id/receipt",
  userAuth,
  readFile,
  async (req, res) => {
    try {
      const txn = await ownTransaction(req);
      if (!txn) {
        return res.status(404).json({ message: "Transaction not found" });
      }
      const body = Buffer.isBuffer(req.body) ? req.body : null;
      if (!body?.length) {
        return res.status(400).json({ message: "Choose a file to upload." });
      }
      const kind = sniff(body);
      if (!kind) {
        return res
          .status(415)
          .json({ message: "Receipts must be a JPG, PNG, WebP or PDF file." });
      }
      const key = await putReceipt(req.user._id, body, kind.ext);
      const old = txn.receipt?.key;
      txn.receipt = {
        key,
        contentType: kind.contentType,
        size: body.length,
        name: cleanName(req.get("x-file-name")),
        uploadedAt: new Date(),
      };
      try {
        await txn.save();
      } catch (error) {
        await removeReceipt(key); // don't leave an orphan file behind
        throw error;
      }
      await removeReceipt(old); // replaced
      res.json({ message: "Receipt attached", receipt: txn.receipt });
    } catch (error) {
      fail(res, error);
    }
  }
);

receiptRouter.get(
  "/user/transaction/:id/receipt",
  userAuth,
  async (req, res) => {
    try {
      const txn = await ownTransaction(req);
      if (!txn?.receipt?.key) {
        return res.status(404).json({ message: "No receipt" });
      }
      const { contentType, key, name } = txn.receipt;
      const ext = key.split(".").pop();
      res.set({
        "Content-Type": contentType,
        "Content-Disposition": `inline; filename="receipt.${ext}"; filename*=UTF-8''${encodeURIComponent(name)}`,
        "Cache-Control": "private, max-age=3600",
        // nothing in an uploaded file may run scripts or load anything
        "Content-Security-Policy":
          "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      });
      streamReceipt(key)
        .on("error", () => {
          if (!res.headersSent) res.status(404).json({ message: "No receipt" });
          else res.end();
        })
        .pipe(res);
    } catch (error) {
      fail(res, error);
    }
  }
);

receiptRouter.delete(
  "/user/transaction/:id/receipt",
  userAuth,
  async (req, res) => {
    try {
      const txn = await ownTransaction(req);
      if (!txn) {
        return res.status(404).json({ message: "Transaction not found" });
      }
      const key = txn.receipt?.key;
      if (!key) return res.json({ message: "No receipt to remove" });
      txn.receipt = null;
      await txn.save();
      await removeReceipt(key);
      res.json({ message: "Receipt removed" });
    } catch (error) {
      fail(res, error);
    }
  }
);

export default receiptRouter;
