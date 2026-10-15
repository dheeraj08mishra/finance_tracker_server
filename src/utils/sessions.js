import jwt from "jsonwebtoken";
import Session from "../model/session.js";
import { setAuthCookie } from "./security.js";
// "last active" is written at most this often, not on every request
const TOUCH_EVERY_MS = 5 * 60 * 1000;

// "Chrome on macOS" from a User-Agent header (no library: just the big ones)
export function deviceLabel(userAgent = "") {
  const ua = String(userAgent);
  const browser =
    [
      [/Edg\//, "Edge"],
      [/OPR\/|Opera/, "Opera"],
      [/SamsungBrowser/, "Samsung Internet"],
      [/Firefox\/|FxiOS/, "Firefox"],
      [/Chrome\/|CriOS/, "Chrome"],
      [/Safari\//, "Safari"],
    ].find(([re]) => re.test(ua))?.[1] || "Browser";
  const os =
    [
      [/iPhone|iPad|iPod/, "iOS"],
      [/Android/, "Android"],
      [/Windows/, "Windows"],
      [/Mac OS X|Macintosh/, "macOS"],
      [/CrOS/, "ChromeOS"],
      [/Linux/, "Linux"],
    ].find(([re]) => re.test(ua))?.[1] || "";
  return os ? `${browser} on ${os}` : browser;
}

// Records this sign-in and sets the login cookie for it. The record
// expires together with the token (JWT_EXPIRATION).
export async function startSession(req, res, user) {
  const session = new Session({
    userId: user._id,
    device: deviceLabel(req.get("user-agent")),
    ip: String(req.ip || "").slice(0, 64),
  });
  const token = user.getJWT(session._id);
  session.expiresAt = new Date(jwt.decode(token).exp * 1000);
  await session.save();
  setAuthCookie(res, token);
  return session;
}

// The session a token belongs to, or null when it was signed out
export async function findSession(sid, userId) {
  const session = await Session.findOne({ _id: sid, userId });
  if (session && Date.now() - session.lastSeenAt > TOUCH_EVERY_MS) {
    session.lastSeenAt = new Date();
    session.save().catch(() => {}); // best effort, never blocks the request
  }
  return session;
}

export const endSession = (sid) =>
  sid ? Session.deleteOne({ _id: sid }) : Promise.resolve();

// Every device (password changed or reset)
export const endAllSessions = (userId) => Session.deleteMany({ userId });
