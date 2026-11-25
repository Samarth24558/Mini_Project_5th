import Truck from "../../dbms/models/Truck.js";
import Shipment from "../../dbms/models/Shipment.js";
import Incident from "../../dbms/models/Incident.js";
import TelemetryRecord from "../../dbms/models/TelemetryRecord.js";
import AlertEvent from "../../dbms/models/AlertEvent.js";

export async function getDashboard(req, res) {
  try {
    const [trucks, shipments, incidents, openIncidents, alerts, latest] = await Promise.all([
      Truck.countDocuments(), Shipment.countDocuments(), Incident.countDocuments(),
      Incident.countDocuments({ status: { $in: ["new", "active", "acknowledged", "in_progress"] } }),
      AlertEvent.countDocuments({ status: { $in: ["pending", "failed"] } }),
      TelemetryRecord.findOne().sort({ timestamp: -1 }).populate("shipmentId", "origin destination truckId")
    ]);
    const shipmentStatuses = await Shipment.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]);
    const severityCounts = await Incident.aggregate([{ $match: { status: { $nin: ["resolved", "closed"] } } }, { $group: { _id: "$severity", count: { $sum: 1 } } }]);
    const recentIncidents = await Incident.find().populate("shipmentId", "origin destination").populate("assignedTeamId", "teamName").sort({ detectedAt: -1 }).limit(6);
    const recentTelemetry = await TelemetryRecord.find().populate("shipmentId", "origin destination").sort({ timestamp: -1 }).limit(12);
    res.json({ success: true, data: { thresholds: { minTemp: Number(process.env.TEMP_MIN_C ?? 2), maxTemp: Number(process.env.TEMP_MAX_C ?? 8), lowFuel: Number(process.env.LOW_FUEL_THRESHOLD ?? 15) }, totals: { trucks, shipments, incidents, openIncidents, pendingAlerts: alerts }, shipmentStatuses, severityCounts, latestReading: latest, recentIncidents, recentTelemetry } });
  } catch { res.status(500).json({ success: false, message: "Failed to load dashboard" }); }
}
