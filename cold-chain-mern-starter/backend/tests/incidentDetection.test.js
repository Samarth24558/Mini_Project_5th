import test from "node:test";
import assert from "node:assert/strict";
import { classifyTelemetry } from "../src/subjects/dsa/incidentDetection.js";

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
  const timestamp = new Date();
  const events = classifyTelemetry({
    temperature: 4,
    doorStatus: "open",
    doorOpenSince: new Date(timestamp.getTime() - 300_000),
    timestamp,
    fuelLevel: 8,
    brakeStatus: "failure"
  });
  assert.deepEqual(events.map(x => x.type), ["door_open", "low_fuel", "brake_problem"]);
  assert.equal(events.at(-1).severity, "critical");
});

test("simulation alert readings cover temperature, door and brake incidents", () => {
  const temperature = classifyTelemetry({ temperature: 12, doorStatus: "closed", fuelLevel: 75, brakeStatus: "normal" });
  const doorTimestamp = new Date();
  const door = classifyTelemetry({
    temperature: 4,
    doorStatus: "open",
    isSimulated: true,
    doorOpenSince: new Date(doorTimestamp.getTime() - 8_000),
    timestamp: doorTimestamp,
    fuelLevel: 75,
    brakeStatus: "normal"
  });
  const brake = classifyTelemetry({ temperature: 4, doorStatus: "closed", fuelLevel: 75, brakeStatus: "warning" });
  assert.deepEqual([temperature[0]?.type, door[0]?.type, brake[0]?.type], ["temperature_breach", "door_open", "brake_problem"]);
});

test("temperature thresholds are inclusive and critical severity starts beyond three degrees", () => {
  const options = { minTemp: 2, maxTemp: 8, doorOpenThresholdSeconds: 300 };
  assert.equal(classifyTelemetry({ temperature: 2 }, options).length, 0);
  assert.equal(classifyTelemetry({ temperature: 8 }, options).length, 0);
  assert.equal(classifyTelemetry({ temperature: 1.99 }, options)[0].severity, "high");
  assert.equal(classifyTelemetry({ temperature: 11 }, options)[0].severity, "high");
  assert.equal(classifyTelemetry({ temperature: 11.01 }, options)[0].severity, "critical");
});

test("missing sensor values do not create false alarms and low-fuel threshold is exclusive", () => {
  assert.deepEqual(classifyTelemetry({ temperature: null, humidity: 65, fuelLevel: null }), []);
  assert.equal(classifyTelemetry({ fuelLevel: 15 })[0], undefined);
  assert.equal(classifyTelemetry({ fuelLevel: 14.99 })[0]?.type, "low_fuel");
});

test("door-open alerts require the configured duration", () => {
  const options = { minTemp: 2, maxTemp: 8, doorOpenThresholdSeconds: 300 };
  const startedAt = new Date("2026-01-01T00:00:00Z");
  const readingAt = seconds => ({
    doorStatus: "open",
    doorOpenSince: startedAt,
    timestamp: new Date(startedAt.getTime() + seconds * 1000)
  });

  assert.equal(classifyTelemetry(readingAt(299), options).length, 0);
  assert.equal(classifyTelemetry(readingAt(300), options)[0].type, "door_open");
  assert.equal(classifyTelemetry({
    ...readingAt(300),
    doorStatus: "closed"
  }, options).length, 0);
});

test("simulated door alerts use the accelerated simulation threshold", () => {
  const startedAt = new Date("2026-01-01T00:00:00Z");
  const events = classifyTelemetry({
    doorStatus: "open",
    isSimulated: true,
    doorOpenSince: startedAt,
    timestamp: new Date(startedAt.getTime() + 8_000)
  });

  assert.equal(events[0]?.type, "door_open");
});

test("incident types route to their specialist response teams", async () => {
  const { teamTypeForIncident } = await import("../src/subjects/dsa/incidentDetection.js");
  assert.equal(teamTypeForIncident("temperature_breach"), "cold_chain");
  assert.equal(teamTypeForIncident("low_fuel"), "fuel_support");
  assert.equal(teamTypeForIncident("brake_problem"), "maintenance");
  assert.equal(teamTypeForIncident("accident"), "emergency_response");
});
