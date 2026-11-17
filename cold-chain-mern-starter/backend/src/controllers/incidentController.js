import mongoose from "mongoose";
import Incident from "../models/Incident.js";
import AlertEvent from "../models/AlertEvent.js";
import AuditLog from "../models/AuditLog.js";
import Team from "../models/Team.js";
import TeamAssignment from "../models/TeamAssignment.js";
import { deleteIncidentBranch, withDeletionTransaction } from "../services/recordDeletion.js";

export async function listIncidents(req, res) {
  try {
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    if (req.query.severity) filter.severity = req.query.severity;
    if (req.query.shipmentId) filter.shipmentId = req.query.shipmentId;
    const data = await Incident.find(filter)
      .populate({ path: "shipmentId", select: "origin destination status truckId isSimulated", populate: { path: "truckId", select: "plateNo driverName isSimulated" } })
      .populate("assignedTeamId", "teamName teamType contactInfo")
      .sort({ detectedAt: -1 })
      .limit(300);
    res.json({ success: true, count: data.length, data });
  } catch { res.status(500).json({ success: false, message: "Failed to load incidents" }); }
}

export async function createManualIncident(req, res) {
  try {
    const { shipmentId, type = "other", severity = "medium", description = "Manually reported incident" } = req.body;
    if (!mongoose.isValidObjectId(shipmentId)) return res.status(400).json({ success: false, message: "Valid shipmentId is required" });
    const incident = await Incident.create({ shipmentId, type, severity, description, status: "new" });
    const alert = await AlertEvent.create({ incidentId: incident._id, alertType: type, message: description, channel: "dashboard", status: "sent", sentAt: new Date() });
    await AuditLog.create({ incidentId: incident._id, alertEventId: alert._id, action: "incident_created", actionBy: req.appUser?._id, remarks: "Manually created from dashboard" });
    res.status(201).json({ success: true, data: incident });
  } catch (error) { res.status(400).json({ success: false, message: error.message }); }
}

export async function updateIncident(req, res) {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ success: false, message: "Invalid incident ID" });
    const allowed = ["status", "severity", "description", "resolutionNote"];
    const updates = Object.fromEntries(allowed.filter(key => Object.hasOwn(req.body, key)).map(key => [key, req.body[key]]));
    if (updates.status === "resolved" || updates.status === "closed") updates.resolvedAt = new Date();
    const incident = await Incident.findByIdAndUpdate(id, updates, { new: true, runValidators: true }).populate("shipmentId").populate("assignedTeamId");
    if (!incident) return res.status(404).json({ success: false, message: "Incident not found" });
    await AuditLog.create({ incidentId: incident._id, action: `incident_${updates.status || "updated"}`, actionBy: req.appUser?._id, remarks: updates.resolutionNote || updates.description || "Incident updated", metadata: updates });
    res.json({ success: true, data: incident });
  } catch (error) { res.status(400).json({ success: false, message: error.message }); }
}

export async function assignIncident(req, res) {
  try {
    const { id } = req.params;
    const { teamId, note = "" } = req.body;
    if (!mongoose.isValidObjectId(id) || !mongoose.isValidObjectId(teamId)) return res.status(400).json({ success: false, message: "Valid incident and team IDs are required" });
    const [incident, team] = await Promise.all([Incident.findById(id), Team.findById(teamId)]);
    if (!incident || !team) return res.status(404).json({ success: false, message: "Incident or team not found" });
    incident.assignedTeamId = team._id;
    if (incident.status === "new") incident.status = "active";
    await incident.save();
    await TeamAssignment.create({ incidentId: incident._id, teamId: team._id, assignedBy: req.appUser?._id, role: "primary", status: "assigned", note });
    await AuditLog.create({ incidentId: incident._id, action: "team_assigned", actionBy: req.appUser?._id, remarks: note, metadata: { teamId: String(team._id) } });
    res.json({ success: true, data: incident });
  } catch (error) { res.status(400).json({ success: false, message: error.message }); }
}

export async function deleteIncident(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid incident ID" });
    const result = await withDeletionTransaction(async session => {
      const incident = await Incident.findById(req.params.id).session(session);
      if (!incident) return null;
      return deleteIncidentBranch([incident._id], session);
    });
    if (!result) return res.status(404).json({ success: false, message: "Incident not found" });
    return res.json({ success: true, message: "Incident and linked alerts and history deleted", data: result });
  } catch (error) {
    console.error("deleteIncident:", error);
    return res.status(500).json({ success: false, message: "Failed to delete incident and linked records" });
  }
}

export async function deleteAlert(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid alert ID" });
    const result = await withDeletionTransaction(async session => {
      const alert = await AlertEvent.findById(req.params.id).session(session);
      if (!alert) return null;
      const auditLogs = await AuditLog.deleteMany({ alertEventId: alert._id }, { session });
      await AlertEvent.deleteOne({ _id: alert._id }, { session });
      return { alert: alert._id, auditLogs: auditLogs.deletedCount };
    });
    if (!result) return res.status(404).json({ success: false, message: "Alert not found" });
    return res.json({ success: true, message: "Alert and its linked audit entries deleted", data: result });
  } catch (error) {
    console.error("deleteAlert:", error);
    return res.status(500).json({ success: false, message: "Failed to delete alert" });
  }
}

export async function deleteAuditEntry(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid audit entry ID" });
    const result = await withDeletionTransaction(async session => {
      const deletion = await AuditLog.deleteOne({ _id: req.params.id }, { session });
      return deletion.deletedCount;
    });
    if (!result) return res.status(404).json({ success: false, message: "Audit entry not found" });
    return res.json({ success: true, message: "Audit entry deleted" });
  } catch (error) {
    console.error("deleteAuditEntry:", error);
    return res.status(500).json({ success: false, message: "Failed to delete audit entry" });
  }
}

export async function deleteAssignment(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid assignment ID" });
    const result = await withDeletionTransaction(async session => {
      const assignment = await TeamAssignment.findById(req.params.id).session(session);
      if (!assignment) return null;
      await TeamAssignment.deleteOne({ _id: assignment._id }, { session });
      const remainingActiveAssignment = await TeamAssignment.exists({
        incidentId: assignment.incidentId,
        teamId: assignment.teamId,
        status: { $ne: "completed" }
      }).session(session);
      if (!remainingActiveAssignment) {
        await Incident.updateOne(
          { _id: assignment.incidentId, assignedTeamId: assignment.teamId },
          { $set: { assignedTeamId: null } },
          { session }
        );
      }
      return assignment._id;
    });
    if (!result) return res.status(404).json({ success: false, message: "Assignment history entry not found" });
    return res.json({ success: true, message: "Assignment history entry deleted" });
  } catch (error) {
    console.error("deleteAssignment:", error);
    return res.status(500).json({ success: false, message: "Failed to delete assignment history entry" });
  }
}

export async function listAlerts(req, res) {
  try {
    const data = await AlertEvent.find().populate({ path: "incidentId", populate: { path: "shipmentId", select: "origin destination" } }).sort({ createdAt: -1 }).limit(300);
    res.json({ success: true, count: data.length, data });
  } catch { res.status(500).json({ success: false, message: "Failed to load alerts" }); }
}

export async function listAudit(req, res) {
  try {
    const data = await AuditLog.find().populate("incidentId", "type severity status").sort({ actionTime: -1 }).limit(300);
    res.json({ success: true, count: data.length, data });
  } catch { res.status(500).json({ success: false, message: "Failed to load audit log" }); }
}

export async function listAssignments(req, res) {
  try {
    const data = await TeamAssignment.find().populate("teamId", "teamName teamType").populate("incidentId", "type severity status").sort({ assignedAt: -1 }).limit(300);
    res.json({ success: true, count: data.length, data });
  } catch { res.status(500).json({ success: false, message: "Failed to load team assignments" }); }
}
