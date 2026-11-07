import Incident from "../models/Incident.js";
import Team from "../models/Team.js";
import TeamAssignment from "../models/TeamAssignment.js";
import AlertEvent from "../models/AlertEvent.js";
import AuditLog from "../models/AuditLog.js";
import Shipment from "../models/Shipment.js";
import { sendIncidentEmail } from "./emailService.js";

const minTemp = Number(process.env.TEMP_MIN_C ?? 2);
const maxTemp = Number(process.env.TEMP_MAX_C ?? 8);

export function classifyTelemetry(reading) {
  const events = [];
  if (Number.isFinite(reading.temperature) && (reading.temperature < minTemp || reading.temperature > maxTemp)) {
    events.push({ type: "temperature_breach", severity: reading.temperature < minTemp - 3 || reading.temperature > maxTemp + 3 ? "critical" : "high", description: `Temperature ${reading.temperature}°C is outside the configured ${minTemp}°C to ${maxTemp}°C range.` });
  }
  if (reading.doorStatus === "open") events.push({ type: "door_open", severity: "medium", description: "Refrigerated cargo door is reported open." });
  if (Number.isFinite(reading.fuelLevel) && reading.fuelLevel < Number(process.env.LOW_FUEL_THRESHOLD ?? 15)) events.push({ type: "low_fuel", severity: "medium", description: `Fuel level is low at ${reading.fuelLevel}%.` });
  if (reading.brakeStatus === "failure" || reading.brakeStatus === "warning") events.push({ type: "brake_problem", severity: reading.brakeStatus === "failure" ? "critical" : "high", description: `Brake status reported as ${reading.brakeStatus}.` });
  return events;
}

export async function detectIncidentsForTelemetry(reading) {
  const shipment = await Shipment.findById(reading.shipmentId).populate("truckId");
  if (!shipment) return [];
  const created = [];
  for (const event of classifyTelemetry(reading)) {
    const existing = await Incident.findOne({ shipmentId: reading.shipmentId, type: event.type, status: { $in: ["new", "active", "acknowledged", "in_progress"] } });
    if (existing) continue;

    const teamType = event.type === "low_fuel" ? "fuel_support" : event.type === "brake_problem" ? "maintenance" : event.type === "accident" ? "emergency_response" : "cold_chain";
    const team = await Team.findOne({ teamType, status: "active" }).sort({ createdAt: 1 });
    const incident = await Incident.create({
      shipmentId: reading.shipmentId,
      type: event.type,
      severity: event.severity,
      status: "new",
      assignedTeamId: team?._id ?? null,
      description: event.description,
      evidence: { temperature: reading.temperature, doorStatus: reading.doorStatus, fuelLevel: reading.fuelLevel, brakeStatus: reading.brakeStatus, telemetryRecordId: reading._id }
    });

    if (team) await TeamAssignment.create({ incidentId: incident._id, teamId: team._id, role: "primary", status: "assigned", note: "Automatically assigned by incident routing rules." });
    const recipients = team?.contactInfo?.email ? [team.contactInfo.email] : [];
    const alert = await AlertEvent.create({ incidentId: incident._id, alertType: event.type, message: event.description, recipients, channel: recipients.length ? "both" : "dashboard", status: recipients.length ? "pending" : "sent", sentAt: recipients.length ? null : new Date() });
    await AuditLog.create({ incidentId: incident._id, alertEventId: alert._id, action: "incident_detected", remarks: "Automatically generated from telemetry.", metadata: { telemetryRecordId: String(reading._id), assignedTeamId: team?._id ?? null } });

    if (recipients.length && process.env.RESEND_API_KEY && process.env.ALERT_FROM_EMAIL) {
      try {
        const sent = await sendIncidentEmail({ to: recipients, subject: `[${event.severity.toUpperCase()}] Cold-chain ${event.type.replaceAll("_", " ")}`, incident, shipment, team });
        alert.status = "sent";
        alert.providerMessageId = sent?.id ?? "";
        alert.sentAt = new Date();
      } catch (error) {
        alert.status = "failed";
        alert.errorMessage = error.message;
      }
      await alert.save();
    }
    created.push(incident);
  }
  return created;
}
