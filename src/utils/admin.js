import User from "../model/user.js";

// Grant or revoke admin by email. Used by the make-admin script; there is
// deliberately no API for this.
export async function setRole(email, role) {
  if (!["user", "admin"].includes(role))
    throw new Error(`Unknown role ${role}`);
  const user = await User.findOneAndUpdate(
    { email: String(email).trim().toLowerCase() },
    { role },
    { new: true }
  );
  return user;
}
