import mongoose from "mongoose";
import AuditLog from "../../dbms/models/AuditLog.js";
import Team from "../../dbms/models/Team.js";
import TeamAssignment from "../../dbms/models/TeamAssignment.js";
import Upload from "../../dbms/models/Upload.js";
import User from "../../dbms/models/User.js";
import { sendRoleAssignmentEmail } from "../services/emailService.js";
import { deleteUploadBranch, withDeletionTransaction } from "../../dbms/recordDeletion.js";

export async function syncProfile(req, res) {
  try {
    const name = String(req.body.name || "").trim().slice(0, 120);
    const email = String(req.body.email || "").trim().toLowerCase().slice(0, 254);
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ success: false, message: "A valid name and email are required" });

    const adminIds = (process.env.ADMIN_CLERK_USER_IDS || "").split(",").map(x => x.trim()).filter(Boolean);
    const adminEmails = (process.env.ADMIN_ALERT_EMAILS || "").split(",").map(x => x.trim()).filter(Boolean);
    const isAdmin = adminIds.includes(req.clerkUserId);
    const defaultRole = isAdmin ? "admin" : "pending_assignment";

    let user = await User.findOne({ clerkUserId: req.clerkUserId });
    if (!user) {
      user = await User.create({ clerkUserId: req.clerkUserId, name, email, role: defaultRole });
    } else {
      user.name = name;
      user.email = email;
      if (isAdmin) user.role = "admin";
      await user.save();
    }

    if (!isAdmin && user.role === "pending_assignment" && adminEmails.length > 0 && !user.roleAssignmentNotifiedAt) {
      try {
        await sendRoleAssignmentEmail({ to: adminEmails, user: { name, email } });
        user.roleAssignmentNotifiedAt = new Date();
        await user.save();
      } catch (error) {
        console.warn("Failed to send role-assignment reminder email", error.message);
      }
    }

    res.json({ success: true, data: user });
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
}

export async function getProfile(req, res) {
  if (!req.appUser) return res.status(404).json({ success: false, message: "Profile not synchronized. Call POST /api/users/sync first." });
  res.json({ success: true, data: req.appUser });
}

export async function listPendingUsers(_req, res) {
  try {
    const users = await User.find({ role: "pending_assignment", status: "active" })
      .select("name email role createdAt")
      .sort({ createdAt: 1 })
      .lean();
    res.json({ success: true, data: users });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

export async function listUsers(_req, res) {
  try {
    const users = await User.find({ status: "active", role: { $ne: "pending_assignment" } })
      .select("name email role canRunSimulation createdAt")
      .sort({ name: 1 })
      .lean();
    res.json({ success: true, data: users });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

export async function updateSimulationAccess(req, res) {
  try {
    if (typeof req.body?.canRunSimulation !== "boolean") {
      return res.status(400).json({ success: false, message: "canRunSimulation must be true or false." });
    }

    const targetUser = await User.findById(req.params.id);
    if (!targetUser || targetUser.status !== "active") {
      return res.status(404).json({ success: false, message: "Active user not found." });
    }
    if (["admin", "fleet_manager"].includes(targetUser.role)) {
      return res.status(409).json({ success: false, message: "Administrators and fleet managers already have simulator access through their role." });
    }
    if (targetUser.role === "pending_assignment") {
      return res.status(409).json({ success: false, message: "Assign the user's role before granting simulator access." });
    }

    targetUser.canRunSimulation = req.body.canRunSimulation;
    await targetUser.save();
    res.json({ success: true, data: targetUser });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

export async function assignUserRole(req, res) {
  try {
    const role = String(req.body?.role || "").trim();
    const allowedRoles = ["fleet_manager", "driver", "action_team_member", "compliance_officer"];
    if (!allowedRoles.includes(role)) {
      return res.status(400).json({ success: false, message: "Choose a valid role for this user." });
    }

    const currentUser = await User.findOne({ clerkUserId: req.clerkUserId, status: "active" }).lean();
    if (!currentUser || (currentUser.role !== "admin" && currentUser.role !== "fleet_manager")) {
      return res.status(403).json({ success: false, message: "Only fleet managers or administrators can assign roles." });
    }

    const targetUser = await User.findById(req.params.id);
    if (!targetUser) return res.status(404).json({ success: false, message: "User not found." });

    if (role === "admin" && currentUser.role !== "admin") {
      return res.status(403).json({ success: false, message: "Only administrators can assign the admin role." });
    }

    targetUser.role = role;
    await targetUser.save();
    res.json({ success: true, data: targetUser });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

export async function deleteUser(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid user ID." });
    const result = await withDeletionTransaction(async session => {
      const user = await User.findById(req.params.id).session(session);
      if (!user) return null;
      if (String(user._id) === String(req.appUser?._id)) return "self";
      if (user.role === "admin" && await User.countDocuments({ role: "admin", status: "active" }).session(session) <= 1) return "last-admin";

      const uploadIds = await Upload.find({ userId: user._id }).distinct("_id").session(session);
      const uploads = await deleteUploadBranch(uploadIds, session);
      await Team.updateMany({ memberUserIds: user._id }, { $pull: { memberUserIds: user._id } }, { session });
      await TeamAssignment.updateMany({ assignedBy: user._id }, { $set: { assignedBy: null } }, { session });
      await AuditLog.updateMany({ actionBy: user._id }, { $set: { actionBy: null } }, { session });
      await User.deleteOne({ _id: user._id }, { session });
      return { name: user.name, uploads: uploads.uploads, telemetry: uploads.telemetry, incidents: uploads.incidents };
    });
    if (!result) return res.status(404).json({ success: false, message: "User not found." });
    if (result === "self") return res.status(409).json({ success: false, message: "You cannot delete your own account from this screen." });
    if (result === "last-admin") return res.status(409).json({ success: false, message: "The last active administrator cannot be deleted." });
    return res.json({ success: true, message: "App user profile and owned uploads deleted; shared audit history was retained.", data: result });
  } catch (error) {
    console.error("deleteUser:", error);
    return res.status(500).json({ success: false, message: "Failed to delete user and owned records." });
  }
}
