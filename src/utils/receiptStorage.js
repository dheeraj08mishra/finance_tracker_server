import { randomUUID } from "node:crypto";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";

// Receipts live on local disk (RECEIPTS_DIR, default ./uploads/receipts).
// Everything goes through put/stream/remove, so an S3 version can replace
// this file at deploy time without touching the routes.
export const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;

const root = () => path.resolve(process.env.RECEIPTS_DIR || "uploads/receipts");

// Path on disk for a stored key, refusing anything outside the root
const fileFor = (key) => {
  const base = root();
  const full = path.resolve(base, key);
  if (!full.startsWith(base + path.sep)) throw new Error("Bad receipt key");
  return full;
};

// What the bytes really are (the browser's Content-Type is not trusted)
export function sniff(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)
    return { ext: "jpg", contentType: "image/jpeg" };
  if (buf.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")))
    return { ext: "png", contentType: "image/png" };
  if (
    buf.subarray(0, 4).toString("latin1") === "RIFF" &&
    buf.subarray(8, 12).toString("latin1") === "WEBP"
  )
    return { ext: "webp", contentType: "image/webp" };
  if (buf.subarray(0, 5).toString("latin1") === "%PDF-")
    return { ext: "pdf", contentType: "application/pdf" };
  return null;
}

// Saves the bytes under a new random key: "<userId>/<uuid>.<ext>"
export async function putReceipt(userId, buf, ext) {
  const key = `${userId}/${randomUUID()}.${ext}`;
  const file = fileFor(key);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, buf, { flag: "wx" });
  return key;
}

export const streamReceipt = (key) => createReadStream(fileFor(key));

// Best effort: a missing file is already gone
export async function removeReceipt(key) {
  if (!key) return;
  try {
    await unlink(fileFor(key));
  } catch (err) {
    if (err.code !== "ENOENT") console.error("[RECEIPT] delete failed:", err);
  }
}
