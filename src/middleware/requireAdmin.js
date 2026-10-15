// Use after userAuth. 403 for signed-in users who aren't admins.
const requireAdmin = (req, res, next) => {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ message: "Admins only." });
  }
  next();
};
export default requireAdmin;
