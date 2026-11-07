import Shipment from "../models/Shipment.js";
import Incident from "../models/Incident.js";
import TelemetryRecord from "../models/TelemetryRecord.js";

const csv = value => {
  let text = String(value ?? "");
  if (/^[\s]*[=+@\-\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
};

export async function exportReport(req, res) {
  try {
    const { type = "telemetry", from, to } = req.query;
    const range = { ...(from ? { $gte: new Date(from) } : {}), ...(to ? { $lte: new Date(to) } : {}) };
    let rows = [];
    let headers = [];
    if (type === "incidents") {
      const docs = await Incident.find(Object.keys(range).length ? { detectedAt: range } : {}).populate("shipmentId", "origin destination").populate("assignedTeamId", "teamName").sort({ detectedAt: -1 }).limit(10000);
      headers = ["incidentId", "detectedAt", "shipment", "type", "severity", "status", "assignedTeam", "description"];
      rows = docs.map(x => [x._id, x.detectedAt.toISOString(), `${x.shipmentId?.origin ?? ""} -> ${x.shipmentId?.destination ?? ""}`, x.type, x.severity, x.status, x.assignedTeamId?.teamName, x.description]);
    } else if (type === "shipments") {
      const docs = await Shipment.find().populate("truckId", "plateNo driverName").sort({ createdAt: -1 }).limit(10000);
      headers = ["shipmentId", "origin", "destination", "truck", "driver", "status", "createdAt", "departedAt", "deliveredAt"];
      rows = docs.map(x => [x._id, x.origin, x.destination, x.truckId?.plateNo, x.truckId?.driverName, x.status, x.createdAt?.toISOString(), x.departedAt?.toISOString(), x.deliveredAt?.toISOString()]);
    } else {
      const docs = await TelemetryRecord.find(Object.keys(range).length ? { timestamp: range } : {}).populate("shipmentId", "origin destination").sort({ timestamp: -1 }).limit(20000);
      headers = ["timestamp", "shipmentId", "route", "temperatureC", "humidityPercent", "doorStatus", "fuelPercent", "brakeStatus", "latitude", "longitude", "simulated"];
      rows = docs.map(x => [x.timestamp.toISOString(), x.shipmentId?._id, `${x.shipmentId?.origin ?? ""} -> ${x.shipmentId?.destination ?? ""}`, x.temperature, x.humidity, x.doorStatus, x.fuelLevel, x.brakeStatus, x.location?.latitude, x.location?.longitude, x.isSimulated]);
    }
    const body = [headers, ...rows].map(row => row.map(csv).join(",")).join("\r\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="cold-chain-${type}-report.csv"`);
    res.send(`\uFEFF${body}`);
  } catch { res.status(500).json({ success: false, message: "Report export failed" }); }
}
