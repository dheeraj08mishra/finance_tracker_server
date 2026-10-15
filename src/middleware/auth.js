import User from "../model/user.js";
import jwt from "jsonwebtoken";
import { findSession, requestToken } from "../utils/sessions.js";
const userAuth = async (req, res, next) => {
  try {
    // website: cookie · mobile app: Authorization: Bearer <access token>
    const { token, bearer } = requestToken(req);
    if (!token) {
      return res
        .status(401)
        .json({ message: "Unauthorized: No token provided" });
    }
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    // app tokens always belong to a session
    if (!decoded || (bearer && !decoded.sid)) {
      return res.status(401).json({ message: "Unauthorized: Invalid token" });
    }
    const user = await User.findById(decoded.userId).select("-password");
    if (!user) {
      return res.status(401).json({ message: "Unauthorized: User not found" });
    }
    // A password change bumps tokenVersion, signing out every older session
    // (tokens from before this feature carry no version and count as 0)
    if ((decoded.tv ?? 0) !== (user.tokenVersion ?? 0)) {
      return res
        .status(401)
        .json({ message: "Your password was changed. Please sign in again." });
    }
    // Signed out from another device (Profile → Signed-in devices).
    // Tokens from before sessions existed have no sid; they expire in a day.
    if (decoded.sid && !(await findSession(decoded.sid, user._id))) {
      return res
        .status(401)
        .json({ message: "This device was signed out. Please sign in again." });
    }
    req.sessionId = decoded.sid || null;
    req.user = user; // Attach user to request object
    next();
  } catch (error) {
    return res.status(401).json({ message: "Unauthorized" });
  }
};
export default userAuth;
