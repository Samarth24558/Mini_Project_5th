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

test("simulation alert readings cover temperature, door and brake incidents", () => {
  const temperature = classifyTelemetry({ temperature: 12, doorStatus: "closed", fuelLevel: 75, brakeStatus: "normal" });
  const door = classifyTelemetry({ temperature: 4, doorStatus: "open", fuelLevel: 75, brakeStatus: "normal" });
  const brake = classifyTelemetry({ temperature: 4, doorStatus: "closed", fuelLevel: 75, brakeStatus: "warning" });
  assert.deepEqual([temperature[0]?.type, door[0]?.type, brake[0]?.type], ["temperature_breach", "door_open", "brake_problem"]);
});
