import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { parseTelemetryFile } from "../src/subjects/dsa/telemetryImport.js";

test("CSV import preserves quoted commas and escaped quotes", async () => {
  const file = {
    name: "telemetry.csv",
    text: async () => 'timestamp,temperature,location\n2026-01-01T00:00:00Z,4.5,"Dock, ""A"""'
  };
  const [row] = await parseTelemetryFile(file, "shipment-id");

  assert.equal(row.shipmentId, "shipment-id");
  assert.equal(row.temperature, 4.5);
  assert.equal(row.location.label, 'Dock, "A"');
});

test("CSV import rejects unterminated quoted fields", async () => {
  const file = { name: "telemetry.csv", text: async () => 'temperature,location\n4.5,"Dock' };
  await assert.rejects(parseTelemetryFile(file, "shipment-id"), /unclosed quoted field/);
});

test("Excel import normalizes the first worksheet and date cells", async () => {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Readings");
  worksheet.addRow(["timestamp", "temperature", "humidity"]);
  worksheet.addRow([new Date("2026-01-01T00:00:00.000Z"), 4.5, 65]);
  const bytes = Buffer.from(await workbook.xlsx.writeBuffer());
  const file = {
    name: "telemetry.xlsx",
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  };
  const [row] = await parseTelemetryFile(file, "shipment-id");

  assert.equal(row.timestamp, "2026-01-01T00:00:00.000Z");
  assert.equal(row.temperature, 4.5);
  assert.equal(row.humidity, 65);
});
