import mongoose from "mongoose";
import Incident from "../models/Incident.js";
import AlertEvent from "../models/AlertEvent.js";
import AuditLog from "../models/AuditLog.js";
import Team from "../models/Team.js";
import TeamAssignment from "../models/TeamAssignment.js";

export async function listIncidents(req, res) {
  try {
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    if (req.query.severity) filter.severity = req.query.severity;
    if (req.query.shipmentId) filter.shipmentId = req.query.shipmentId;
    const data = await Incident.find(filter).populate("shipmentId", "origin destination status truckId").populate("assignedTeamId", "teamName teamType contactInfo").sort({ detectedAt: -1 }).limit(300);
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
