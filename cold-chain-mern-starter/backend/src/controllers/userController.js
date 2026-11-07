import User from "../models/User.js";

export async function syncProfile(req, res) {
  try {
    const name = String(req.body.name || "").trim().slice(0, 120);
    const email = String(req.body.email || "").trim().toLowerCase().slice(0, 254);
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ success: false, message: "A valid name and email are required" });
    const adminIds = (process.env.ADMIN_CLERK_USER_IDS || "").split(",").map(x => x.trim()).filter(Boolean);
    let user = await User.findOne({ clerkUserId: req.clerkUserId });
    if (!user) {
      const role = adminIds.includes(req.clerkUserId) ? "admin" : "driver";
      user = await User.create({ clerkUserId: req.clerkUserId, name, email, role });
    } else {
      user.name = name;
      user.email = email;
      if (adminIds.includes(req.clerkUserId)) user.role = "admin";
      await user.save();
    }
    res.json({ success: true, data: user });
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
}

export async function getProfile(req, res) {
  if (!req.appUser) return res.status(404).json({ success: false, message: "Profile not synchronized. Call POST /api/users/sync first." });
  res.json({ success: true, data: req.appUser });
}
