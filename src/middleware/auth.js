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
    req.user = user; // Attach user to request object
    next();
  } catch (error) {
    return res
      .status(401)
      .json({ message: "Unauthorized", details: error.message });
  }
};
export default userAuth;
