import test from "node:test";
import assert from "node:assert/strict";
import { classifyTelemetry } from "../src/services/incidentDetection.js";

test("temperature inside configured default range does not create a breach", () => {
  const events = classifyTelemetry({ temperature: 4.5, doorStatus: "closed", fuelLevel: 80, brakeStatus: "normal" });
  assert.equal(events.some(x => x.type === "temperature_breach"), false);
});

test("temperature outside range creates a temperature breach", () => {
  const events = classifyTelemetry({ temperature: 10, doorStatus: "closed", fuelLevel: 80, brakeStatus: "normal" });
  assert.equal(events[0]?.type, "temperature_breach");
  assert.equal(events[0]?.severity, "high");
});

test("door, low fuel and brake failures create separate events", () => {
  const events = classifyTelemetry({ temperature: 4, doorStatus: "open", fuelLevel: 8, brakeStatus: "failure" });
  assert.deepEqual(events.map(x => x.type), ["door_open", "low_fuel", "brake_problem"]);
  assert.equal(events.at(-1).severity, "critical");
});
