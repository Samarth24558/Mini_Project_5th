import dns from "node:dns";
import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";
import User from "../src/subjects/dbms/models/User.js";
import Truck from "../src/subjects/dbms/models/Truck.js";
import Shipment from "../src/subjects/dbms/models/Shipment.js";
import Upload from "../src/subjects/dbms/models/Upload.js";
import TelemetryRecord from "../src/subjects/dbms/models/TelemetryRecord.js";

dns.setServers(["8.8.8.8", "1.1.1.1"]);

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"' && quoted && text[i + 1] === '"') {
      value += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(value.trim());
      value = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(value.trim());
      if (row.some(cell => cell !== "")) rows.push(row);
      row = [];
      value = "";
    } else {
      value += char;
    }
  }

  if (value !== "" || row.length) {
    row.push(value.trim());
    if (row.some(cell => cell !== "")) rows.push(row);
  }
  if (quoted) throw new Error("CSV contains an unterminated quoted field");
  if (rows.length < 2) throw new Error("CSV must contain a header and at least one data row");

  const headers = rows[0].map(header => header.replace(/^\uFEFF/, "").trim());
  return rows.slice(1).map((cells, index) => {
    if (cells.length !== headers.length) throw new Error(`CSV row ${index + 2} has ${cells.length} columns; expected ${headers.length}`);
    return Object.fromEntries(headers.map((header, i) => {
      const cell = cells[i];
      return [header.toLowerCase().replace(/[^a-z0-9]/g, ""), cell !== "" && Number.isFinite(Number(cell)) ? Number(cell) : cell];
    }));
  });
}

function requiredNumber(row, field, rowNumber) {
  const value = Number(row[field]);
  if (!Number.isFinite(value)) throw new Error(`CSV row ${rowNumber} has an invalid ${field}`);
  return value;
}

const defaultDatasetPath = fileURLToPath(new URL("../../../Cold_Chain_Logistics_Dataset (1).csv", import.meta.url));
const datasetPath = path.resolve(process.argv[2] || defaultDatasetPath);
const fileName = path.basename(datasetPath);
let upload;

try {
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is missing from backend/.env");
  const content = await fs.readFile(datasetPath, "utf8");
  const rows = parseCsv(content);
  if (rows.length > 10000) throw new Error("Dataset exceeds the 10,000 row import limit");

  await mongoose.connect(process.env.MONGODB_URI);
  const activeUsers = await User.find({ status: "active" }).sort({ createdAt: 1 });
  const user = process.env.DATASET_SEED_USER_ID
    ? activeUsers.find(candidate => String(candidate._id) === process.env.DATASET_SEED_USER_ID)
    : activeUsers.length === 1 ? activeUsers[0] : null;
  if (!user) throw new Error("Set DATASET_SEED_USER_ID to an active app user's MongoDB ID to choose the dataset owner");

  if (!["fleet_manager", "admin"].includes(user.role)) {
    user.role = "fleet_manager";
    await user.save();
    console.log("Promoted the sole active app profile to fleet_manager for dataset controls.");
  }

  const truck = await Truck.findOneAndUpdate(
    { plateNo: "DATASET-DEMO-001" },
    { $setOnInsert: { driverName: "Dataset Simulation", plateNo: "DATASET-DEMO-001", capacityKg: 10000, status: "active" } },
    { new: true, upsert: true, runValidators: true }
  );
  const shipment = await Shipment.findOneAndUpdate(
    { truckId: truck._id, origin: "Dataset Simulation", destination: "Dataset Replay Route" },
    { $setOnInsert: { truckId: truck._id, origin: "Dataset Simulation", destination: "Dataset Replay Route", status: "in_transit" } },
    { new: true, upsert: true, runValidators: true }
  );

  const existingUpload = await Upload.findOne({ userId: user._id, fileName });
  if (existingUpload) {
    const existingRows = await TelemetryRecord.countDocuments({ uploadId: existingUpload._id });
    if (existingRows !== rows.length) {
      throw new Error(`An upload named "${fileName}" already exists with ${existingRows} rows; refusing to create duplicate dataset records`);
    }
    console.log(`Dataset already exists in Atlas: ${existingRows} rows; upload ID ${existingUpload._id}`);
    console.log(`Demo shipment ID: ${shipment._id}`);
  } else {
    upload = await Upload.create({
      userId: user._id,
      fileName,
      fileType: "csv",
      status: "processed",
      totalRows: rows.length,
      validRows: rows.length,
      rejectedRows: 0,
      simulationStatus: "pending",
      simulationProcessedRows: 0,
      simulationIncidentTypes: []
    });

    const timestampStart = Date.now() - rows.length * 1000;
    for (let offset = 0; offset < rows.length; offset += 500) {
      const batch = rows.slice(offset, offset + 500).map((row, index) => {
        const sourceRowNumber = offset + index + 1;
        const temperature = requiredNumber(row, "temperaturec", sourceRowNumber + 1);
        const humidity = requiredNumber(row, "humiditypercent", sourceRowNumber + 1);
        const fuelLevel = requiredNumber(row, "fuellevelpercent", sourceRowNumber + 1);
        if (humidity < 0 || humidity > 100) throw new Error(`CSV row ${sourceRowNumber + 1} has humidity outside 0-100`);
        if (fuelLevel < 0 || fuelLevel > 100) throw new Error(`CSV row ${sourceRowNumber + 1} has fuel outside 0-100`);
        return {
          uploadId: upload._id,
          shipmentId: shipment._id,
          timestamp: new Date(timestampStart + (sourceRowNumber - 1) * 1000),
          temperature,
          humidity,
          fuelLevel,
          doorStatus: "unknown",
          brakeStatus: "unknown",
          location: { label: `Route distance ${row.routedistancekm} km` },
          sourceData: row,
          sourceRowNumber,
          isSimulated: false
        };
      });
      await TelemetryRecord.insertMany(batch, { ordered: true });
    }
    console.log(`Seeded ${rows.length} dataset rows into Atlas.`);
    console.log(`Upload ID: ${upload._id}`);
    console.log(`Demo shipment ID: ${shipment._id}`);
  }
} catch (error) {
  console.error("Dataset seed failed:", error.message);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
