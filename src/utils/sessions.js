import { createHash, randomBytes } from "node:crypto";
import jwt from "jsonwebtoken";
import Session from "../model/session.js";
import User from "../model/user.js";
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

// ---------- mobile app tokens ----------
// The app signs in with "X-Auth-Mode: token" and gets a short access token
// (sent as "Authorization: Bearer …") plus a refresh token, instead of the
// website's cookie, which a native app can't rely on.
export const ACCESS_TOKEN_TTL = "15m";
const ACCESS_TOKEN_SECONDS = 15 * 60;
// An app stays signed in while it's used at least this often
const APP_SESSION_MS = 60 * 24 * 60 * 60 * 1000; // 60 days
// Two refreshes this close together are a retry race, not theft
const RACE_MS = 30 * 1000;

export const wantsTokens = (req) => req.get("x-auth-mode") === "token";
const sha256 = (s) => createHash("sha256").update(String(s)).digest("hex");
const newRefreshToken = () => randomBytes(32).toString("base64url");
const appDeviceName = (req) =>
  String(req.get("x-device-name") || "")
    .replace(/[^\p{L}\p{N} ._()-]/gu, "")
    .trim()
    .slice(0, 60) || `BudgetWise app (${deviceLabel(req.get("user-agent"))})`;

const tokensFor = (user, sessionId, refreshToken) => ({
  accessToken: user.getJWT(sessionId, ACCESS_TOKEN_TTL),
  refreshToken,
  expiresIn: ACCESS_TOKEN_SECONDS,
});

// Records this sign-in. Website: sets the login cookie; the record expires
// with it (JWT_EXPIRATION). App ("X-Auth-Mode: token"): returns tokens.
// Returns { session, tokens } (tokens is null for the website).
export async function startSession(req, res, user) {
  const base = {
    userId: user._id,
    ip: String(req.ip || "").slice(0, 64),
  };
  if (wantsTokens(req)) {
    const refreshToken = newRefreshToken();
    const session = await Session.create({
      ...base,
      kind: "app",
      device: appDeviceName(req),
      refreshHash: sha256(refreshToken),
      expiresAt: new Date(Date.now() + APP_SESSION_MS),
    });
    return { session, tokens: tokensFor(user, session._id, refreshToken) };
  }
  const session = new Session({
    ...base,
    device: deviceLabel(req.get("user-agent")),
  });
  const token = user.getJWT(session._id);
  session.expiresAt = new Date(jwt.decode(token).exp * 1000);
  await session.save();
  setAuthCookie(res, token);
  return { session, tokens: null };
}

// Swaps a refresh token for new tokens (the old refresh token stops
// working). Returns { tokens } or { error, status }.
export async function refreshSession(refreshToken) {
  if (typeof refreshToken !== "string" || refreshToken.length < 20) {
    return { status: 400, error: "A refresh token is required." };
  }
  const hash = sha256(refreshToken);
  const now = new Date();
  const next = newRefreshToken();
  // atomic: of two requests with the same token only one can win
  const session = await Session.findOneAndUpdate(
    { refreshHash: hash, kind: "app", expiresAt: { $gt: now } },
    {
      refreshHash: sha256(next),
      previousRefreshHash: hash,
      rotatedAt: now,
      lastSeenAt: now,
      expiresAt: new Date(now.getTime() + APP_SESSION_MS),
    },
    { new: true }
  );
  if (!session) {
    const reused = await Session.findOne({ previousRefreshHash: hash });
    if (reused && now - reused.rotatedAt < RACE_MS) {
      return {
        status: 409,
        error: "Already refreshed. Use the newest tokens.",
      };
    }
    // an old token came back: someone may have copied it. End the session.
    if (reused) await Session.deleteOne({ _id: reused._id });
    return { status: 401, error: "Please sign in again." };
  }
  const user = await User.findById(session.userId);
  if (!user) {
    await Session.deleteOne({ _id: session._id });
    return { status: 401, error: "Please sign in again." };
  }
  return { tokens: tokensFor(user, session._id, next) };
}

// App sign-out with the refresh token (works even if the access token
// has expired)
export const endSessionByRefreshToken = (refreshToken) =>
  typeof refreshToken === "string" && refreshToken
    ? Session.deleteOne({ refreshHash: sha256(refreshToken) })
    : Promise.resolve();

// The login token of a request: the app's "Authorization: Bearer" header,
// else the website's cookie
export function requestToken(req) {
  const auth = req.get("authorization") || "";
  if (/^Bearer\s+\S+$/i.test(auth)) {
    return { token: auth.split(/\s+/)[1], bearer: true };
  }
  return { token: req.cookies?.token || null, bearer: false };
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
