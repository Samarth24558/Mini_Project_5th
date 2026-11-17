import mongoose from "mongoose";
import TelemetryRecord from "../models/TelemetryRecord.js";
import Shipment from "../models/Shipment.js";
import Truck from "../models/Truck.js";
import Upload from "../models/Upload.js";
import { classifyTelemetry, detectIncidentsForTelemetry } from "../services/incidentDetection.js";
import { publishTelemetryEvent } from "../services/telemetryEvents.js";
import { deleteTelemetryBranch, deleteUploadBranch, withDeletionTransaction } from "../services/recordDeletion.js";

const SIMULATION_FLEET_SIZE = 20;
const SIMULATION_BATCH_SIZE = 1;

function validOptionalNumber(value, min, max) {
  if (value === undefined || value === null || value === "") return true;
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max;
}

async function saveReading(input, uploadId = null, sourceRowNumber = null, evaluate = true, publishEvent = true) {
  const shipment = await Shipment.findById(input.shipmentId);
  if (!shipment) throw Object.assign(new Error(`Shipment not found: ${input.shipmentId}`), { status: 404 });
  const timestamp = input.timestamp ? new Date(input.timestamp) : new Date();
  if (Number.isNaN(timestamp.getTime())) throw Object.assign(new Error("Invalid timestamp"), { status: 400 });
  const reading = await TelemetryRecord.create({
    shipmentId: input.shipmentId,
    uploadId,
    sourceRowNumber,
    timestamp,
    temperature: input.temperature === "" || input.temperature == null ? null : Number(input.temperature),
    humidity: input.humidity === "" || input.humidity == null ? null : Number(input.humidity),
    doorStatus: input.doorStatus || "unknown",
    fuelLevel: input.fuelLevel === "" || input.fuelLevel == null ? null : Number(input.fuelLevel),
    brakeStatus: input.brakeStatus || "unknown",
    location: input.location || {},
    sourceData: input.sourceData || null,
    isSimulated: input.isSimulated ?? false
  });
  const incidents = evaluate ? await detectIncidentsForTelemetry(reading) : [];
  if (evaluate && publishEvent) publishTelemetryEvent({ shipmentId: String(reading.shipmentId), readingId: String(reading._id), timestamp: reading.timestamp, detectedIncidents: incidents.length });
  return { reading, incidents };
}

export async function createSimulationFleet(req, res) {
  try {
    const origin = String(req.body.origin || "").trim();
    const destination = String(req.body.destination || "").trim();
    if (!origin || !destination || origin.length > 100 || destination.length > 100) {
      return res.status(400).json({ success: false, message: "A valid origin and destination are required" });
    }

    const data = [];
    for (let index = 1; index <= SIMULATION_FLEET_SIZE; index += 1) {
      const suffix = String(index).padStart(2, "0");
      const simulationKey = `demo-fleet-${suffix}`;
      const truck = await Truck.findOneAndUpdate(
        { simulationKey },
        { $set: { simulationKey, driverName: `Simulation Driver ${suffix}`, plateNo: `SIM-DEMO-${suffix}`, capacityKg: 10000, status: "active", isSimulated: true } },
        { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
      );
      const shipment = await Shipment.findOneAndUpdate(
        { simulationKey },
        { $set: { simulationKey, truckId: truck._id, origin, destination, status: "in_transit", isSimulated: true } },
        { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
      );
      data.push({
        truckId: String(truck._id),
        shipmentId: String(shipment._id),
        plateNo: truck.plateNo,
        driverName: truck.driverName,
        origin: shipment.origin,
        destination: shipment.destination
      });
    }
    return res.json({ success: true, count: data.length, data });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ success: false, message: "A demo fleet registration conflicts with an existing truck plate" });
    console.error("createSimulationFleet:", error);
    return res.status(500).json({ success: false, message: "Failed to prepare the simulation fleet" });
  }
}

export async function createSimulationTelemetryBatch(req, res) {
  try {
    const { readings } = req.body;
    if (!Array.isArray(readings) || readings.length !== SIMULATION_BATCH_SIZE) {
      return res.status(400).json({ success: false, message: "Provide exactly one simulated truck reading" });
    }
    const shipmentIds = readings.map(reading => reading?.shipmentId);
    if (shipmentIds.some(id => !mongoose.isValidObjectId(id)) || new Set(shipmentIds.map(String)).size !== SIMULATION_BATCH_SIZE) {
      return res.status(400).json({ success: false, message: "Provide one unique valid demo shipmentId" });
    }
    for (const reading of readings) {
      if (reading.temperature != null && !Number.isFinite(Number(reading.temperature))) return res.status(400).json({ success: false, message: "Temperature must be numeric" });
      if (!validOptionalNumber(reading.humidity, 0, 100)) return res.status(400).json({ success: false, message: "Humidity must be between 0 and 100" });
      if (!validOptionalNumber(reading.fuelLevel, 0, 100)) return res.status(400).json({ success: false, message: "Fuel level must be between 0 and 100" });
    }

    const shipments = await Shipment.find({ _id: { $in: shipmentIds }, isSimulated: true }).populate("truckId", "plateNo driverName");
    if (shipments.length !== SIMULATION_BATCH_SIZE) {
      return res.status(400).json({ success: false, message: "The simulation reading must use one registered demo shipment" });
    }
    const shipmentById = new Map(shipments.map(shipment => [String(shipment._id), shipment]));
    const saved = await Promise.all(readings.map(reading => saveReading({ ...reading, isSimulated: true }, null, null, true, false)));
    const alerts = saved.flatMap(({ reading, incidents }) => incidents.map(incident => {
      const shipment = shipmentById.get(String(reading.shipmentId));
      return {
        incidentId: String(incident._id),
        shipmentId: String(shipment._id),
        plateNo: shipment.truckId?.plateNo || "Unknown truck",
        driverName: shipment.truckId?.driverName || "Unknown driver",
        origin: shipment.origin,
        destination: shipment.destination,
        type: incident.type,
        severity: incident.severity,
        description: incident.description,
        detectedAt: incident.detectedAt
      };
    }));
    publishTelemetryEvent({ simulation: true, readingCount: saved.length, detectedIncidents: alerts.length, timestamp: new Date() });
    return res.status(201).json({ success: true, data: { readingCount: saved.length, detectedIncidents: alerts.length, alerts } });
  } catch (error) {
    const status = error.status || (error.name === "ValidationError" || error.name === "CastError" ? 400 : 500);
    if (status === 500) console.error("createSimulationTelemetryBatch:", error);
    return res.status(status).json({ success: false, message: status < 500 ? error.message : "Failed to save simulated truck readings" });
  }
}

export async function createTelemetry(req, res) {
  try {
    const body = req.body;
    if (!body.shipmentId || !mongoose.isValidObjectId(body.shipmentId)) return res.status(400).json({ success: false, message: "A valid shipmentId is required" });
    if (body.temperature != null && !Number.isFinite(Number(body.temperature))) return res.status(400).json({ success: false, message: "Temperature must be numeric" });
    if (!validOptionalNumber(body.humidity, 0, 100)) return res.status(400).json({ success: false, message: "Humidity must be between 0 and 100" });
    if (!validOptionalNumber(body.fuelLevel, 0, 100)) return res.status(400).json({ success: false, message: "Fuel level must be between 0 and 100" });
    const { reading, incidents } = await saveReading(body);
    return res.status(201).json({ success: true, message: "Telemetry saved", data: reading, detectedIncidents: incidents.length });
  } catch (error) {
    const status = error.status || (error.name === "ValidationError" || error.name === "CastError" ? 400 : 500);
    return res.status(status).json({ success: false, message: status < 500 ? error.message : "Failed to save telemetry" });
  }
}

export async function getTelemetry(req, res) {
  try {
    const { shipmentId, limit = 100, from, to } = req.query;
    const filter = {};
    if (shipmentId) {
      if (!mongoose.isValidObjectId(shipmentId)) return res.status(400).json({ success: false, message: "Invalid shipmentId" });
      filter.shipmentId = shipmentId;
    }
    if (from || to) filter.timestamp = { ...(from ? { $gte: new Date(from) } : {}), ...(to ? { $lte: new Date(to) } : {}) };
    const records = await TelemetryRecord.find(filter).populate({ path: "shipmentId", select: "origin destination status truckId", populate: { path: "truckId", select: "plateNo driverName" } }).sort({ timestamp: -1 }).limit(Math.min(Math.max(Number(limit) || 100, 1), 1000));
    res.json({ success: true, count: records.length, data: records });
  } catch {
    res.status(500).json({ success: false, message: "Failed to fetch telemetry" });
  }
}

export async function getLatestTelemetry(req, res) {
  try {
    const rows = await TelemetryRecord.aggregate([
      { $sort: { timestamp: -1 } },
      { $group: { _id: "$shipmentId", readingId: { $first: "$_id" }, temperature: { $first: "$temperature" }, humidity: { $first: "$humidity" }, doorStatus: { $first: "$doorStatus" }, fuelLevel: { $first: "$fuelLevel" }, brakeStatus: { $first: "$brakeStatus" }, location: { $first: "$location" }, timestamp: { $first: "$timestamp" }, isSimulated: { $first: "$isSimulated" } } },
      { $sort: { timestamp: -1 } }
    ]);
    const ids = rows.map(row => row._id);
    const shipments = await Shipment.find({ _id: { $in: ids } }).populate("truckId", "plateNo driverName");
    const map = new Map(shipments.map(s => [String(s._id), s]));
    res.json({ success: true, data: rows.map(row => ({ ...row, shipment: map.get(String(row._id)) ?? null })) });
  } catch {
    res.status(500).json({ success: false, message: "Failed to fetch latest telemetry" });
  }
}

export async function importTelemetry(req, res) {
  try {
    const { rows } = req.body;
    if (!Array.isArray(rows) || rows.length === 0 || rows.length > 10000) return res.status(400).json({ success: false, message: "Provide between 1 and 10,000 telemetry rows" });
    const upload = await Upload.create({ userId: req.appUser?._id, fileName: String(req.body.fileName || "telemetry-import.csv").slice(0, 200), fileType: "csv", status: "validating", totalRows: rows.length });
    let validRows = 0;
    const errors = [];
    for (let i = 0; i < rows.length; i += 1) {
      try {
        const row = rows[i];
        if (!row.shipmentId || !mongoose.isValidObjectId(row.shipmentId)) throw new Error("Invalid shipmentId");
        if (row.temperature != null && !Number.isFinite(Number(row.temperature))) throw new Error("Invalid temperature");
        await saveReading({ ...row, isSimulated: false }, upload._id, i + 1, false);
        validRows += 1;
      } catch (error) {
        errors.push({ row: i + 1, message: error.message });
      }
    }
    upload.validRows = validRows;
    upload.rejectedRows = errors.length;
    upload.status = errors.length ? (validRows ? "partially_processed" : "failed") : "processed";
    upload.simulationStatus = "pending";
    upload.simulationProcessedRows = 0;
    upload.simulationIncidentTypes = [];
    upload.validationMessage = errors.slice(0, 30).map(e => `Row ${e.row}: ${e.message}`).join("; ");
    await upload.save();
    res.status(201).json({ success: true, data: upload, errors: errors.slice(0, 100) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message || "Import failed" });
  }
}

export async function getTelemetryUploads(req, res) {
  try {
    const uploads = await Upload.find({ userId: req.appUser._id })
      .select("fileName uploadTime status totalRows validRows rejectedRows simulationStatus simulationProcessedRows")
      .sort({ uploadTime: -1 })
      .limit(25)
      .lean();
    return res.json({ success: true, data: uploads });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to fetch uploaded datasets" });
  }
}

export async function deleteTelemetryRecord(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid telemetry record ID" });
    const result = await withDeletionTransaction(async session => {
      const reading = await TelemetryRecord.findById(req.params.id).session(session);
      if (!reading) return null;
      if (reading.uploadId && await Upload.exists({ _id: reading.uploadId }).session(session)) {
        return deleteUploadBranch([reading.uploadId], session);
      }
      return deleteTelemetryBranch([reading._id], session);
    });
    if (!result) return res.status(404).json({ success: false, message: "Telemetry record not found" });
    return res.json({ success: true, message: "Telemetry record and linked incidents deleted", data: result });
  } catch (error) {
    console.error("deleteTelemetryRecord:", error);
    return res.status(500).json({ success: false, message: "Failed to delete telemetry record and linked data" });
  }
}

export async function deleteTelemetryUpload(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.uploadId)) return res.status(400).json({ success: false, message: "Invalid upload ID" });
    const result = await withDeletionTransaction(async session => {
      const upload = await Upload.findById(req.params.uploadId).session(session);
      if (!upload) return null;
      if (String(upload.userId) !== String(req.appUser?._id) && req.appUser?.role !== "admin") return "not-owned";
      return deleteUploadBranch([upload._id], session);
    });
    if (!result) return res.status(404).json({ success: false, message: "Uploaded dataset not found" });
    if (result === "not-owned") return res.status(404).json({ success: false, message: "Uploaded dataset not found" });
    return res.json({ success: true, message: "Uploaded dataset and linked telemetry history deleted", data: result });
  } catch (error) {
    console.error("deleteTelemetryUpload:", error);
    return res.status(500).json({ success: false, message: "Failed to delete uploaded dataset and linked data" });
  }
}

export async function simulateUploadedTelemetry(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.uploadId)) {
      return res.status(400).json({ success: false, message: "Invalid upload ID" });
    }

    const upload = await Upload.findById(req.params.uploadId);
    if (!upload) return res.status(404).json({ success: false, message: "Uploaded dataset not found" });
    if (String(upload.userId) !== String(req.appUser._id) && req.appUser.role !== "admin") {
      return res.status(404).json({ success: false, message: "Uploaded dataset not found" });
    }

    if (upload.simulationStatus === "completed" || upload.validRows === 0) {
      upload.simulationStatus = "completed";
      await upload.save();
      return res.json({
        success: true,
        complete: true,
        simulation: { processedRows: upload.simulationProcessedRows, totalRows: upload.validRows }
      });
    }

    const batchSize = Math.min(Math.max(Number(req.body?.batchSize) || 100, 1), 250);
    const readings = await TelemetryRecord.find({ uploadId: upload._id })
      .sort({ sourceRowNumber: 1 })
      .where("sourceRowNumber").gt(upload.simulationProcessedRows)
      .limit(batchSize);
    const batch = readings;
    if (!batch.length) {
      upload.simulationStatus = "completed";
      await upload.save();
      return res.json({
        success: true,
        complete: true,
        simulation: { processedRows: upload.simulationProcessedRows, totalRows: upload.validRows }
      });
    }

    const evaluatedTypes = new Set(upload.simulationIncidentTypes);
    let detectedIncidents = 0;
    for (const reading of batch) {
      const eventTypes = classifyTelemetry(reading).map(event => event.type);
      if (eventTypes.some(type => !evaluatedTypes.has(type))) {
        const incidents = await detectIncidentsForTelemetry(reading);
        detectedIncidents += incidents.length;
        for (const type of eventTypes) evaluatedTypes.add(type);
      }
    }

    await TelemetryRecord.updateMany(
      { _id: { $in: batch.map(reading => reading._id) } },
      { $set: { isSimulated: true } }
    );
    const lastReading = batch[batch.length - 1];
    publishTelemetryEvent({
      shipmentId: String(lastReading.shipmentId),
      readingId: String(lastReading._id),
      timestamp: lastReading.timestamp,
      detectedIncidents
    });

    upload.simulationProcessedRows += batch.length;
    upload.simulationIncidentTypes = [...evaluatedTypes];
    upload.simulationStatus = upload.simulationProcessedRows >= upload.validRows ? "completed" : "running";
    await upload.save();

    return res.json({
      success: true,
      complete: upload.simulationStatus === "completed",
      detectedIncidents,
      simulation: { processedRows: upload.simulationProcessedRows, totalRows: upload.validRows }
    });
  } catch (error) {
    const status = error.status || (error.name === "ValidationError" || error.name === "CastError" ? 400 : 500);
    return res.status(status).json({ success: false, message: status < 500 ? error.message : "Failed to simulate uploaded telemetry" });
  }
}
