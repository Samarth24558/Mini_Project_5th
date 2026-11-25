import Incident from "../dbms/models/Incident.js";
import Team from "../dbms/models/Team.js";
import TeamAssignment from "../dbms/models/TeamAssignment.js";
import AlertEvent from "../dbms/models/AlertEvent.js";
import AuditLog from "../dbms/models/AuditLog.js";
import Shipment from "../dbms/models/Shipment.js";
import { sendIncidentEmail } from "../webTechnology/services/emailService.js";
import { withMongoTransaction } from "../dbms/recordDeletion.js";

const minTemp = Number(process.env.TEMP_MIN_C ?? 2);
const maxTemp = Number(process.env.TEMP_MAX_C ?? 8);

export function classifyTelemetry(reading, options = {}) {
  const minimum = options.minTemp ?? minTemp;
  const maximum = options.maxTemp ?? maxTemp;
  const configuredDoorThreshold = Number(reading.isSimulated
    ? process.env.SIMULATED_DOOR_OPEN_THRESHOLD_SECONDS ?? 8
    : process.env.DOOR_OPEN_THRESHOLD_SECONDS ?? 300);
  const doorOpenThresholdSeconds = options.doorOpenThresholdSeconds
    ?? (Number.isFinite(configuredDoorThreshold) && configuredDoorThreshold >= 0
      ? configuredDoorThreshold
      : reading.isSimulated ? 8 : 300);
  const events = [];
  if (Number.isFinite(reading.temperature) && (reading.temperature < minimum || reading.temperature > maximum)) {
    events.push({ type: "temperature_breach", severity: reading.temperature < minimum - 3 || reading.temperature > maximum + 3 ? "critical" : "high", description: `Temperature ${reading.temperature}°C is outside the configured ${minimum}°C to ${maximum}°C range.` });
  }
  const doorOpenSince = reading.doorOpenSince ? new Date(reading.doorOpenSince).getTime() : NaN;
  const timestamp = reading.timestamp ? new Date(reading.timestamp).getTime() : NaN;
  const doorOpenDurationSeconds = (timestamp - doorOpenSince) / 1000;
  if (reading.doorStatus === "open" && doorOpenDurationSeconds >= doorOpenThresholdSeconds) {
    events.push({ type: "door_open", severity: "medium", description: `Refrigerated cargo door has remained open for ${Math.floor(doorOpenDurationSeconds)} seconds.` });
  }
  if (Number.isFinite(reading.fuelLevel) && reading.fuelLevel < Number(process.env.LOW_FUEL_THRESHOLD ?? 15)) {
    events.push({ type: "low_fuel", severity: "medium", description: `Fuel level is low at ${reading.fuelLevel}%.` });
  }
  if (reading.brakeStatus === "failure" || reading.brakeStatus === "warning") {
    events.push({ type: "brake_problem", severity: reading.brakeStatus === "failure" ? "critical" : "high", description: `Brake status reported as ${reading.brakeStatus}.` });
  }
  return events;
}

export function teamTypeForIncident(type) {
  if (type === "low_fuel") return "fuel_support";
  if (type === "brake_problem") return "maintenance";
  if (type === "accident") return "emergency_response";
  return "cold_chain";
}

async function persistEvent({ event, shipment, reading, actionBy, auditAction, session }) {
  if (reading?._id) {
    const existing = await Incident.findOne({
      "evidence.telemetryRecordId": reading._id,
      type: event.type
    }).session(session);
    if (existing) return null;
  }

  const teamType = teamTypeForIncident(event.type);
  let team = await Team.findOne({ teamType, status: "active" }).sort({ createdAt: 1 }).session(session);
  if (!team) team = await Team.findOne({ status: "active" }).sort({ createdAt: 1 }).session(session);

  const [incident] = await Incident.create([{
    shipmentId: shipment._id,
    type: event.type,
    severity: event.severity,
    status: "new",
    isSimulated: reading?.isSimulated ?? shipment.isSimulated ?? false,
    assignedTeamId: team?._id ?? null,
    description: event.description,
    evidence: reading ? {
      temperature: reading.temperature,
      doorStatus: reading.doorStatus,
      fuelLevel: reading.fuelLevel,
      brakeStatus: reading.brakeStatus,
      telemetryRecordId: reading._id
    } : undefined
  }], { session });

  if (team) {
    await TeamAssignment.create([{
      incidentId: incident._id,
      teamId: team._id,
      role: "primary",
      status: "assigned",
      note: `Automatically routed to ${team.teamName}.`
    }], { session });
  }

  const recipients = team?.contactInfo?.email ? [team.contactInfo.email] : [];
  const truckLabel = shipment.truckId?.plateNo ? `Truck ${shipment.truckId.plateNo}: ` : "";
  const [alert] = await AlertEvent.create([{
    incidentId: incident._id,
    alertType: event.type,
    message: `${truckLabel}${event.description}`,
    recipients,
    channel: recipients.length ? "both" : "dashboard",
    status: recipients.length ? "pending" : "sent",
    sentAt: recipients.length ? null : new Date()
  }], { session });
  await AuditLog.create([{
    incidentId: incident._id,
    alertEventId: alert._id,
    action: auditAction,
    actionBy,
    remarks: event.description,
    metadata: {
      telemetryRecordId: reading?._id ? String(reading._id) : null,
      assignedTeamId: team?._id ? String(team._id) : null
    }
  }], { session });

  return { incident, alert, team, shipment };
}

export async function deliverPersistedIncidentAlerts(persistedEvents) {
  for (const { incident, alert, team, shipment } of persistedEvents) {
    if (!alert.recipients.length) continue;
    if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
      await AlertEvent.updateOne(
        { _id: alert._id },
        { $set: { status: "failed", errorMessage: "Email service is not configured" } }
      );
      continue;
    }

    let sent;
    try {
      const subjectTruck = shipment.truckId?.plateNo ? ` · ${shipment.truckId.plateNo}` : "";
      sent = await sendIncidentEmail({
        to: alert.recipients,
        subject: `[${incident.severity.toUpperCase()}] Cold-chain ${incident.type.replaceAll("_", " ")}${subjectTruck}`,
        incident,
        shipment,
        team
      });
    } catch (error) {
      await AlertEvent.updateOne(
        { _id: alert._id },
        { $set: { status: "failed", errorMessage: error.message } }
      );
      console.error("Incident email delivery failed:", error.message);
      continue;
    }
    await AlertEvent.updateOne(
      { _id: alert._id },
      { $set: { status: "sent", providerMessageId: sent?.messageId ?? "", sentAt: new Date(), errorMessage: "" } }
    );
  }
}

async function persistIncidentEvents({ shipmentId, events, reading = null, actionBy = null, auditAction, session }) {
  if (!events.length) return { incidents: [], persistedEvents: [] };
  const shipment = await Shipment.findById(shipmentId).populate("truckId").session(session);
  if (!shipment) return null;
  const persistedEvents = [];
  for (const event of events) {
    const saved = await persistEvent({ event, shipment, reading, actionBy, auditAction, session });
    if (saved) persistedEvents.push(saved);
  }
  return {
    incidents: persistedEvents.map(({ incident }) => incident),
    persistedEvents
  };
}

export async function createIncidentsForTelemetryInSession(reading, session) {
  return await persistIncidentEvents({
    shipmentId: reading.shipmentId,
    events: classifyTelemetry(reading),
    reading,
    auditAction: "incident_detected",
    session
  });
}

async function createIncidentEvents({ shipmentId, events, reading = null, actionBy = null, auditAction }) {
  if (!events.length) return [];
  const result = await withMongoTransaction(session =>
    persistIncidentEvents({ shipmentId, events, reading, actionBy, auditAction, session })
  );
  if (!result) return null;
  await deliverPersistedIncidentAlerts(result.persistedEvents);
  return result.incidents;
}

export async function detectIncidentsForTelemetry(reading) {
  return await createIncidentEvents({
    shipmentId: reading.shipmentId,
    events: classifyTelemetry(reading),
    reading,
    auditAction: "incident_detected"
  }) ?? [];
}

export async function createManualIncidentWorkflow({ shipmentId, type, severity, description, actionBy }) {
  const incidents = await createIncidentEvents({
    shipmentId,
    events: [{ type, severity, description }],
    actionBy,
    auditAction: "incident_created"
  });
  return incidents?.[0] ?? null;
}
