import mongoose, { Schema } from "mongoose";

// One signed-in browser/device. The login cookie's token carries this id;
// deleting the document signs that device out on its next request.
const sessionSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    device: { type: String, default: "Unknown device", maxlength: 80 },
    ip: { type: String, default: "", maxlength: 64 },
    lastSeenAt: { type: Date, default: Date.now },
    // Removed by MongoDB once the login itself has expired
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export default mongoose.model("Session", sessionSchema);
