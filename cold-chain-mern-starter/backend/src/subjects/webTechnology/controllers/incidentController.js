import mongoose from "mongoose";
import Incident from "../../dbms/models/Incident.js";
import AlertEvent from "../../dbms/models/AlertEvent.js";
import AuditLog from "../../dbms/models/AuditLog.js";
import Team from "../../dbms/models/Team.js";
import TeamAssignment from "../../dbms/models/TeamAssignment.js";
import { deleteIncidentBranch, withDeletionTransaction, withMongoTransaction } from "../../dbms/recordDeletion.js";
import { createManualIncidentWorkflow } from "../../dsa/incidentDetection.js";

const INCIDENT_STATUS_TRANSITIONS = {
  new: ["active", "acknowledged"],
  active: ["acknowledged", "in_progress"],
  acknowledged: ["in_progress"],
  in_progress: ["resolved"],
  resolved: ["closed"],
  closed: []
};

export function canTransitionIncidentStatus(currentStatus, nextStatus) {
  return currentStatus === nextStatus
    || INCIDENT_STATUS_TRANSITIONS[currentStatus]?.includes(nextStatus) === true;
}

function incidentErrorStatus(error) {
  return error.name === "ValidationError" || error.name === "CastError" ? 400 : 500;
}

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
    const incident = await createManualIncidentWorkflow({
      shipmentId,
      type,
      severity,
      description,
      actionBy: req.appUser?._id
    });
    if (!incident) return res.status(404).json({ success: false, message: "Shipment not found" });
    await incident.populate("shipmentId assignedTeamId");
    res.status(201).json({ success: true, data: incident });
  } catch (error) {
    const status = incidentErrorStatus(error);
    if (status === 500) console.error("createManualIncident:", error);
    res.status(status).json({ success: false, message: status === 400 ? error.message : "Failed to create incident" });
  }
}

export async function updateIncident(req, res) {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ success: false, message: "Invalid incident ID" });
    const allowed = ["status", "severity", "description", "resolutionNote"];
    const updates = Object.fromEntries(allowed.filter(key => Object.hasOwn(req.body, key)).map(key => [key, req.body[key]]));
    if (!Object.keys(updates).length) return res.status(400).json({ success: false, message: "Provide at least one incident field to update" });
    const incident = await withMongoTransaction(async session => {
      const current = await Incident.findById(id).session(session);
      if (!current) return null;
      if (updates.status && !canTransitionIncidentStatus(current.status, updates.status)) {
        return { invalidTransition: true, currentStatus: current.status, nextStatus: updates.status };
      }
      Object.assign(current, updates);
      if ((updates.status === "resolved" || updates.status === "closed") && !current.resolvedAt) {
        current.resolvedAt = new Date();
      }
      await current.save({ session });
      await AuditLog.create([{
        incidentId: current._id,
        action: `incident_${updates.status || "updated"}`,
        actionBy: req.appUser?._id,
        remarks: updates.resolutionNote || updates.description || "Incident updated",
        metadata: updates
      }], { session });
      return current;
    });
    if (!incident) return res.status(404).json({ success: false, message: "Incident not found" });
    if (incident.invalidTransition) {
      return res.status(409).json({
        success: false,
        message: `Incident cannot transition from ${incident.currentStatus} to ${incident.nextStatus}`
      });
    }
    await incident.populate("shipmentId assignedTeamId");
    res.json({ success: true, data: incident });
  } catch (error) {
    const status = incidentErrorStatus(error);
    if (status === 500) console.error("updateIncident:", error);
    res.status(status).json({ success: false, message: status === 400 ? error.message : "Failed to update incident" });
  }
}

export async function assignIncident(req, res) {
  try {
    const { id } = req.params;
    const { teamId, note = "" } = req.body;
    if (!mongoose.isValidObjectId(id) || !mongoose.isValidObjectId(teamId)) return res.status(400).json({ success: false, message: "Valid incident and team IDs are required" });
    const result = await withMongoTransaction(async session => {
      const [incident, team] = await Promise.all([
        Incident.findById(id).session(session),
        Team.findById(teamId).session(session)
      ]);
      if (!incident || !team) return { notFound: true };
      if (team.status !== "active") return { inactiveTeam: true };
      await TeamAssignment.updateMany(
        { incidentId: incident._id, status: { $in: ["assigned", "accepted"] } },
        { $set: { status: "reassigned" } },
        { session }
      );
      incident.assignedTeamId = team._id;
      if (incident.status === "new") incident.status = "active";
      await incident.save({ session });
      await TeamAssignment.create([{
        incidentId: incident._id,
        teamId: team._id,
        assignedBy: req.appUser?._id,
        role: "primary",
        status: "assigned",
        note
      }], { session });
      await AuditLog.create([{
        incidentId: incident._id,
        action: "team_assigned",
        actionBy: req.appUser?._id,
        remarks: note,
        metadata: { teamId: String(team._id) }
      }], { session });
      return incident;
    });
    if (result?.notFound) return res.status(404).json({ success: false, message: "Incident or team not found" });
    if (result?.inactiveTeam) return res.status(409).json({ success: false, message: "Cannot assign an incident to an inactive team" });
    await result.populate("shipmentId assignedTeamId");
    res.json({ success: true, data: result });
  } catch (error) {
    const status = incidentErrorStatus(error);
    if (status === 500) console.error("assignIncident:", error);
    res.status(status).json({ success: false, message: status === 400 ? error.message : "Failed to assign incident" });
  }
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
