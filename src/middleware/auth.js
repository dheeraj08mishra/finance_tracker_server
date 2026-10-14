import User from "../model/user.js";
import jwt from "jsonwebtoken";
const userAuth = async (req, res, next) => {
  try {
    const token = req.cookies.token;
    if (!token) {
      return res
        .status(401)
        .json({ message: "Unauthorized: No token provided" });
    }
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (!decoded) {
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
    req.user = user; // Attach user to request object
    next();
  } catch (error) {
    return res
      .status(401)
      .json({ message: "Unauthorized" });
  }
};
export default userAuth;
