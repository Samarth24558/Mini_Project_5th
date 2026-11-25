import mongoose from "mongoose";
import { randomUUID } from "node:crypto";
import TelemetryRecord from "../../dbms/models/TelemetryRecord.js";
import Shipment from "../../dbms/models/Shipment.js";
import Truck from "../../dbms/models/Truck.js";
import Upload from "../../dbms/models/Upload.js";
import {
  createIncidentsForTelemetryInSession,
  deliverPersistedIncidentAlerts,
  detectIncidentsForTelemetry
} from "../../dsa/incidentDetection.js";
import { publishTelemetryEvent } from "../services/telemetryEvents.js";
import { deleteTelemetryBranch, deleteUploadBranch, withDeletionTransaction, withMongoTransaction } from "../../dbms/recordDeletion.js";
import { runBoundedWorkers } from "../../os/boundedWorkers.js";
import { replayTelemetryBatch } from "../../dsa/telemetryReplay.js";

const SIMULATION_FLEET_SIZE = 20;
const SIMULATION_BATCH_SIZE = 1;
const DEFAULT_SIMULATION_ROUTES = [
  { origin: "Bengaluru", destination: "Mysuru" },
  { origin: "Chennai", destination: "Bengaluru" },
  { origin: "Hyderabad", destination: "Vijayawada" },
  { origin: "Mumbai", destination: "Pune" }
];

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
  const doorOpenSince = input.doorStatus === "open"
    ? await getDoorOpenSince(input.shipmentId, timestamp)
    : null;
  const readingData = {
    shipmentId: input.shipmentId,
    uploadId,
    sourceRowNumber,
    timestamp,
    doorOpenSince,
    temperature: input.temperature === "" || input.temperature == null ? null : Number(input.temperature),
    humidity: input.humidity === "" || input.humidity == null ? null : Number(input.humidity),
    doorStatus: input.doorStatus || "unknown",
    fuelLevel: input.fuelLevel === "" || input.fuelLevel == null ? null : Number(input.fuelLevel),
    brakeStatus: input.brakeStatus || "unknown",
    location: input.location || {},
    sourceData: input.sourceData || null,
    isSimulated: input.isSimulated ?? false
  };
  let reading;
  let incidents = [];
  if (evaluate) {
    const saved = await withMongoTransaction(async session => {
      const linkedShipment = await Shipment.findById(input.shipmentId).session(session);
      if (!linkedShipment) throw Object.assign(new Error(`Shipment not found: ${input.shipmentId}`), { status: 404 });
      const [createdReading] = await TelemetryRecord.create([readingData], { session });
      const incidentResult = await createIncidentsForTelemetryInSession(createdReading, session);
      if (!incidentResult) throw Object.assign(new Error(`Shipment not found: ${input.shipmentId}`), { status: 404 });
      return { reading: createdReading, incidentResult };
    });
    reading = saved.reading;
    incidents = saved.incidentResult.incidents;
    await deliverPersistedIncidentAlerts(saved.incidentResult.persistedEvents);
  } else {
    reading = await TelemetryRecord.create(readingData);
  }
  if (evaluate && publishEvent) publishTelemetryEvent({ shipmentId: String(reading.shipmentId), readingId: String(reading._id), timestamp: reading.timestamp, detectedIncidents: incidents.length });
  return { reading, incidents };
}

async function getDoorOpenSince(shipmentId, timestamp, beforeId = null) {
  const previousFilter = {
    shipmentId,
    $or: [
      { timestamp: { $lt: timestamp } },
      ...(beforeId ? [{ timestamp, _id: { $lt: beforeId } }] : [])
    ]
  };
  const previous = await TelemetryRecord.findOne(previousFilter).sort({ timestamp: -1, _id: -1 });
  return previous?.doorStatus === "open"
    ? previous.doorOpenSince || previous.timestamp
    : timestamp;
}

export async function createSimulationFleet(req, res) {
  try {
    const origin = String(req.body.origin || "").trim();
    const destination = String(req.body.destination || "").trim();
    const selectedTruckId = req.body.truckId ? String(req.body.truckId).trim() : "";
    if (!origin || !destination || origin.length > 100 || destination.length > 100) {
      return res.status(400).json({ success: false, message: "A valid origin and destination are required" });
    }
    if (selectedTruckId && !mongoose.isValidObjectId(selectedTruckId)) {
      return res.status(400).json({ success: false, message: "A valid demo truck ID is required" });
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
      const defaultRoute = DEFAULT_SIMULATION_ROUTES[(index - 1) % DEFAULT_SIMULATION_ROUTES.length];
      const shipment = await Shipment.findOneAndUpdate(
        { simulationKey },
        {
          $set: { truckId: truck._id, isSimulated: true },
          $setOnInsert: { simulationKey, ...defaultRoute, status: "scheduled" }
        },
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

    if (selectedTruckId) {
      const selectedTruck = data.find(truck => truck.truckId === selectedTruckId);
      if (!selectedTruck) return res.status(404).json({ success: false, message: "Demo truck not found in the simulation fleet" });
      const shipment = await Shipment.findOneAndUpdate(
        { _id: selectedTruck.shipmentId, simulationKey: { $exists: true }, isSimulated: true },
        { $set: { origin, destination, status: "in_transit" } },
        { new: true, runValidators: true }
      );
      if (!shipment) return res.status(404).json({ success: false, message: "Demo shipment not found for the selected truck" });
      selectedTruck.origin = shipment.origin;
      selectedTruck.destination = shipment.destination;
    } else if (new Set(data.map(shipment => `${shipment.origin}\u0000${shipment.destination}`)).size === 1) {
      for (let index = 0; index < data.length; index += 1) {
        const route = DEFAULT_SIMULATION_ROUTES[index % DEFAULT_SIMULATION_ROUTES.length];
        const shipment = await Shipment.findOneAndUpdate(
          { _id: data[index].shipmentId, simulationKey: { $exists: true }, isSimulated: true },
          { $set: route },
          { new: true, runValidators: true }
        );
        if (shipment) {
          data[index].origin = shipment.origin;
          data[index].destination = shipment.destination;
        }
      }
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
    const fileName = String(req.body.fileName || "telemetry-import.csv").slice(0, 200);
    const fileType = fileName.split(".").pop().toLowerCase();
    if (!["csv", "xlsx"].includes(fileType)) {
      return res.status(400).json({ success: false, message: "Only CSV and XLSX datasets are supported" });
    }
    const upload = await Upload.create({ userId: req.appUser?._id, fileName, fileType, status: "validating", totalRows: rows.length });
    const results = await runBoundedWorkers(rows, async (row, index) => {
      try {
        if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error("Invalid telemetry row");
        if (!row.shipmentId || !mongoose.isValidObjectId(row.shipmentId)) throw new Error("Invalid shipmentId");
        if (row.temperature != null && !Number.isFinite(Number(row.temperature))) throw new Error("Invalid temperature");
        await saveReading({ ...row, isSimulated: false }, upload._id, index + 1, false);
        return null;
      } catch (error) {
        return { row: index + 1, message: error.message };
      }
    }, 8);
    const errors = results.filter(Boolean);
    const validRows = rows.length - errors.length;
    upload.validRows = validRows;
    upload.rejectedRows = errors.length;
    upload.status = errors.length ? (validRows ? "partially_processed" : "failed") : "processed";
    upload.simulationStatus = "pending";
    upload.simulationProcessedRows = 0;
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
  const lockId = randomUUID();
  try {
    if (!mongoose.isValidObjectId(req.params.uploadId)) {
      return res.status(400).json({ success: false, message: "Invalid upload ID" });
    }

    const existingUpload = await Upload.findById(req.params.uploadId);
    const upload = existingUpload;
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

    const now = new Date();
    const claimedUpload = await Upload.findOneAndUpdate(
      { _id: upload._id, $or: [{ simulationLockUntil: null }, { simulationLockUntil: { $lt: now } }] },
      { $set: { simulationLockId: lockId, simulationLockUntil: new Date(now.getTime() + 30 * 60 * 1000) } },
      { new: true }
    );
    if (!claimedUpload) return res.status(409).json({ success: false, message: "This dataset is already being replayed" });
    claimedUpload.simulationStatus = "running";
    await claimedUpload.save();

    try {
    const batchSize = Math.min(Math.max(Number(req.body?.batchSize) || 100, 1), 250);
    const readings = await TelemetryRecord.find({
      uploadId: upload._id,
      $or: [{ simulationProcessedAt: null }, { simulationProcessedAt: { $exists: false } }]
    })
      .sort({ timestamp: 1, sourceRowNumber: 1, _id: 1 })
      .limit(batchSize);
    const batch = readings;
    if (!batch.length) {
      upload.simulationProcessedRows = await TelemetryRecord.countDocuments({
        uploadId: upload._id,
        simulationProcessedAt: { $ne: null }
      });
      upload.simulationStatus = "completed";
      await upload.save();
      return res.json({
        success: true,
        complete: true,
        simulation: { processedRows: upload.simulationProcessedRows, totalRows: upload.validRows }
      });
    }

    const detectedIncidents = await replayTelemetryBatch(batch, {
      getDoorOpenSince: reading => getDoorOpenSince(reading.shipmentId, reading.timestamp, reading._id),
      saveReading: reading => reading.save(),
      detectIncidents: detectIncidentsForTelemetry
    });

    await TelemetryRecord.updateMany(
      { _id: { $in: batch.map(reading => reading._id) } },
      { $set: { simulationProcessedAt: new Date() } }
    );
    const lastReading = batch[batch.length - 1];
    publishTelemetryEvent({
      shipmentId: String(lastReading.shipmentId),
      readingId: String(lastReading._id),
      timestamp: lastReading.timestamp,
      detectedIncidents
    });

    upload.simulationProcessedRows = await TelemetryRecord.countDocuments({
      uploadId: upload._id,
      simulationProcessedAt: { $ne: null }
    });
    upload.simulationStatus = upload.simulationProcessedRows >= upload.validRows ? "completed" : "running";
    await upload.save();

    return res.json({
      success: true,
      complete: upload.simulationStatus === "completed",
      detectedIncidents,
      simulation: { processedRows: upload.simulationProcessedRows, totalRows: upload.validRows }
    });
    } finally {
      await Upload.updateOne(
        { _id: upload._id, simulationLockId: lockId },
        { $set: { simulationLockId: "", simulationLockUntil: null } }
      );
    }
  } catch (error) {
    const status = error.status || (error.name === "ValidationError" || error.name === "CastError" ? 400 : 500);
    return res.status(status).json({ success: false, message: status < 500 ? error.message : "Failed to simulate uploaded telemetry" });
  }
}
