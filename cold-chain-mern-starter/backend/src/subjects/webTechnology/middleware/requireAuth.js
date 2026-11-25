import { getAuth } from "@clerk/express";
import User from "../../dbms/models/User.js";

export async function requireAuth(req, res, next) {
  try {
    const auth = getAuth(req);
    if (!auth?.userId) {
      const hasBearerToken = /^Bearer\s+\S+$/i.test(req.get("authorization") || "");
      return res.status(401).json({
        success: false,
        message: hasBearerToken
          ? "Clerk could not verify this session. Check that the backend secret key belongs to the same Clerk application as the frontend publishable key."
          : "No Clerk session token was received. Sign out and sign in again, then retry."
      });
    }
    req.clerkUserId = auth.userId;
    req.appUser = await User.findOne({ clerkUserId: auth.userId, status: "active" }).lean();
    next();
  } catch (error) { next(error); }
}
