import mongoose from "mongoose";
import Team from "../models/Team.js";
import Incident from "../models/Incident.js";
import TeamAssignment from "../models/TeamAssignment.js";
import { withDeletionTransaction } from "../services/recordDeletion.js";

export async function getTeams(_req, res) {
  try { const data = await Team.find().sort({ teamName: 1 }); res.json({ success: true, count: data.length, data }); }
  catch { res.status(500).json({ success: false, message: "Failed to load teams" }); }
}

export async function createTeam(req, res) {
  try {
    const { teamName, teamType = "general", description = "", email = "", phone = "" } = req.body;
    if (!teamName?.trim()) return res.status(400).json({ success: false, message: "Team name is required" });
    const team = await Team.create({ teamName: teamName.trim(), teamType, description, contactInfo: { email, phone } });
    res.status(201).json({ success: true, data: team });
  } catch (error) { res.status(error.code === 11000 ? 409 : 400).json({ success: false, message: error.code === 11000 ? "Team name already exists" : error.message }); }
}

export async function updateTeam(req, res) {
  try {
    const updates = {};
    for (const key of ["teamName", "teamType", "description", "status"]) if (Object.hasOwn(req.body, key)) updates[key] = req.body[key];
    if (req.body.email !== undefined) updates["contactInfo.email"] = req.body.email;
    if (req.body.phone !== undefined) updates["contactInfo.phone"] = req.body.phone;
    const team = await Team.findByIdAndUpdate(req.params.id, { $set: updates }, { new: true, runValidators: true });
    if (!team) return res.status(404).json({ success: false, message: "Team not found" });
    res.json({ success: true, data: team });
  } catch (error) { res.status(400).json({ success: false, message: error.message }); }
}

export async function deleteTeam(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid team ID" });
    const result = await withDeletionTransaction(async session => {
      const team = await Team.findById(req.params.id).session(session);
      if (!team) return null;
      const assignments = await TeamAssignment.deleteMany({ teamId: team._id }, { session });
      const incidents = await Incident.updateMany(
        { assignedTeamId: team._id },
        { $set: { assignedTeamId: null } },
        { session }
      );
      await Team.deleteOne({ _id: team._id }, { session });
      return { teamName: team.teamName, assignments: assignments.deletedCount, incidentsUnassigned: incidents.modifiedCount };
    });
    if (!result) return res.status(404).json({ success: false, message: "Team not found" });
    return res.json({ success: true, message: "Response team and linked assignments deleted; incidents were unassigned", data: result });
  } catch (error) {
    console.error("deleteTeam:", error);
    return res.status(500).json({ success: false, message: "Failed to delete team and linked assignments" });
  }
}
