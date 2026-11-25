import User from "../../dbms/models/User.js";

export function requireRole(...roles) {
  return async (req, res, next) => {
    try {
      const user = await User.findOne({ clerkUserId: req.clerkUserId, status: "active" }).lean();
      if (!user) return res.status(403).json({ success: false, message: "Complete profile setup before accessing this resource" });
      if (user.role === "pending_assignment") {
        return res.status(403).json({ success: false, message: "Your account is waiting for a fleet manager role assignment." });
      }
      if (!roles.includes(user.role)) return res.status(403).json({ success: false, message: "Your account role cannot perform this action" });
      req.appUser = user;
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function hasSimulationAccess(user) {
  return user?.status === "active"
    && user.role !== "pending_assignment"
    && (["admin", "fleet_manager"].includes(user.role) || user.canRunSimulation === true);
}

export async function requireSimulationAccess(req, res, next) {
  try {
    const user = await User.findOne({ clerkUserId: req.clerkUserId, status: "active" }).lean();
    if (!user || user.role === "pending_assignment") {
      return res.status(403).json({ success: false, message: "Complete fleet manager role assignment before accessing simulation." });
    }
    if (!hasSimulationAccess(user)) {
      return res.status(403).json({ success: false, message: "Ask a fleet manager to grant simulator access." });
    }
    req.appUser = user;
    next();
  } catch (error) {
    next(error);
  }
}
