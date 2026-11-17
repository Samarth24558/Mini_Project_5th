import mongoose from "mongoose";
import AlertEvent from "../models/AlertEvent.js";
import AuditLog from "../models/AuditLog.js";
import Incident from "../models/Incident.js";
import Shipment from "../models/Shipment.js";
import TeamAssignment from "../models/TeamAssignment.js";
import TelemetryRecord from "../models/TelemetryRecord.js";
import Upload from "../models/Upload.js";

function uniqueIds(ids) {
  return [...new Map(ids.filter(Boolean).map(id => [String(id), id])).values()];
}

export async function withDeletionTransaction(action) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await action(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}

export async function deleteIncidentBranch(incidentIds, session) {
  const ids = uniqueIds(incidentIds);
  if (!ids.length) return { incidents: 0, alerts: 0, auditLogs: 0, assignments: 0 };

  const alertIds = await AlertEvent.find({ incidentId: { $in: ids } }).distinct("_id").session(session);
  const alerts = await AlertEvent.deleteMany({ incidentId: { $in: ids } }, { session });
  const auditLogs = await AuditLog.deleteMany({
    $or: [{ incidentId: { $in: ids } }, { alertEventId: { $in: alertIds } }]
  }, { session });
  const assignments = await TeamAssignment.deleteMany({ incidentId: { $in: ids } }, { session });
  const incidents = await Incident.deleteMany({ _id: { $in: ids } }, { session });
  return {
    incidents: incidents.deletedCount,
    alerts: alerts.deletedCount,
    auditLogs: auditLogs.deletedCount,
    assignments: assignments.deletedCount
  };
}

export async function deleteTelemetryBranch(telemetryIds, session) {
  const ids = uniqueIds(telemetryIds);
  if (!ids.length) return { telemetry: 0, incidents: 0, alerts: 0, auditLogs: 0, assignments: 0 };

  const incidentIds = await Incident.find({ "evidence.telemetryRecordId": { $in: ids } }).distinct("_id").session(session);
  const related = await deleteIncidentBranch(incidentIds, session);
  const telemetry = await TelemetryRecord.deleteMany({ _id: { $in: ids } }, { session });
  return { telemetry: telemetry.deletedCount, ...related };
}

export async function deleteUploadBranch(uploadIds, session) {
  const ids = uniqueIds(uploadIds);
  if (!ids.length) return { uploads: 0, telemetry: 0, incidents: 0, alerts: 0, auditLogs: 0, assignments: 0 };

  const telemetryIds = await TelemetryRecord.find({ uploadId: { $in: ids } }).distinct("_id").session(session);
  const related = await deleteTelemetryBranch(telemetryIds, session);
  const uploads = await Upload.deleteMany({ _id: { $in: ids } }, { session });
  return { uploads: uploads.deletedCount, ...related };
}

export async function deleteShipmentBranch(shipmentIds, session) {
  const ids = uniqueIds(shipmentIds);
  if (!ids.length) return { shipments: 0, uploads: 0, telemetry: 0, incidents: 0, alerts: 0, auditLogs: 0, assignments: 0 };

  const uploadIds = await TelemetryRecord.find({
    shipmentId: { $in: ids },
    uploadId: { $ne: null }
  }).distinct("uploadId").session(session);
  const uploads = await deleteUploadBranch(uploadIds, session);

  const telemetryIds = await TelemetryRecord.find({ shipmentId: { $in: ids } }).distinct("_id").session(session);
  const telemetry = await TelemetryRecord.deleteMany({ _id: { $in: telemetryIds } }, { session });
  const incidentIds = await Incident.find({ shipmentId: { $in: ids } }).distinct("_id").session(session);
  const incidents = await deleteIncidentBranch(incidentIds, session);
  const shipments = await Shipment.deleteMany({ _id: { $in: ids } }, { session });

  return {
    shipments: shipments.deletedCount,
    uploads: uploads.uploads,
    telemetry: telemetry.deletedCount + uploads.telemetry,
    incidents: incidents.incidents + uploads.incidents,
    alerts: incidents.alerts + uploads.alerts,
    auditLogs: incidents.auditLogs + uploads.auditLogs,
    assignments: incidents.assignments + uploads.assignments
  };
}
