import User from "../models/User.js";

export function requireRole(...roles) {
  return async (req, res, next) => {
    try {
      const user = await User.findOne({ clerkUserId: req.clerkUserId, status: "active" }).lean();
      if (!user) return res.status(403).json({ success: false, message: "Complete profile setup before accessing this resource" });
      if (!roles.includes(user.role)) return res.status(403).json({ success: false, message: "Your account role cannot perform this action" });
      req.appUser = user;
      next();
    } catch (error) {
      next(error);
    }
  };
}
