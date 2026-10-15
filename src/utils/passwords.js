import bcrypt from "bcrypt";
import validator from "validator";

// How many recent passwords (including the current one) can't be reused
export const PASSWORD_HISTORY = 3;

// Message for a password that may not be used, or null if it's fine
export function newPasswordProblem(password) {
  if (typeof password !== "string") return "A new password is required.";
  if (!validator.isStrongPassword(password)) {
    return "New password must be at least 8 characters with upper, lower, number and symbol.";
  }
  // The schema trims passwords, which would silently change this one
  if (password !== password.trim()) {
    return "New password can't start or end with a space.";
  }
  return null;
}

/**
 * Replace a user's password (user loaded with +passwordHistory).
 * Refuses the last PASSWORD_HISTORY passwords, keeps the outgoing hash in
 * the history, signs out every session (tokenVersion) and voids any reset
 * link. Returns an error message, or null when the password was set.
 * The caller saves the user.
 */
export async function setNewPassword(user, newPassword) {
  const recentHashes = [user.password, ...(user.passwordHistory || [])].slice(
    0,
    PASSWORD_HISTORY
  );
  for (const hash of recentHashes) {
    if (await bcrypt.compare(newPassword, hash)) {
      return `You can't reuse any of your last ${PASSWORD_HISTORY} passwords.`;
    }
  }
  user.passwordHistory = recentHashes.slice(0, PASSWORD_HISTORY - 1);
  user.password = newPassword; // hashed by the pre-save hook
  user.passwordChangedAt = new Date();
  user.tokenVersion = (user.tokenVersion || 0) + 1;
  user.passwordResetTokenHash = null;
  user.passwordResetExpires = null;
  return null;
}
