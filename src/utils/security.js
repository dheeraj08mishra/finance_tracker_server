import rateLimit from "express-rate-limit";

const isProduction = process.env.NODE_ENV === "production";

// Same options must be used when setting and clearing the cookie
export const authCookieOptions = {
  httpOnly: true, // not readable from JS
  secure: isProduction, // HTTPS only in production (local dev runs on http)
  sameSite: "strict", // not sent on cross-site requests (CSRF protection)
  path: "/",
};

export const setAuthCookie = (res, token) => {
  res.cookie("token", token, {
    ...authCookieOptions,
    maxAge: Number(process.env.COOKIES_AGE) || 24 * 60 * 60 * 1000, // 1 day
  });
};

export const clearAuthCookie = (res) => {
  res.clearCookie("token", authCookieOptions);
};

const limiter = (windowMinutes, limit, message) =>
  rateLimit({
    windowMs: windowMinutes * 60 * 1000,
    limit,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { message },
  });

// Whole API: generous, stops scripted abuse
// API_RATE_LIMIT overrides the request count (e.g. higher for tests)
export const apiLimiter = limiter(
  15,
  Number(process.env.API_RATE_LIMIT) || 300,
  "Too many requests, slow down."
);

// Login/signup: slows down password guessing
// AUTH_RATE_LIMIT overrides the attempt count (e.g. higher for local tests)
export const authLimiter = limiter(
  15,
  Number(process.env.AUTH_RATE_LIMIT) || 10,
  "Too many login attempts. Try again in 15 minutes."
);

// Routes that call OpenAI (each call costs money)
export const aiLimiter = limiter(
  60,
  30,
  "Tag extraction limit reached. Try again later."
);
