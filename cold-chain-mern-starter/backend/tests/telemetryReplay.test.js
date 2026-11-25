import test from "node:test";
import assert from "node:assert/strict";
import { replayTelemetryBatch } from "../src/services/telemetryReplay.js";

test("replay evaluates every row, including repeated incident types, in supplied timestamp order", async () => {
  const readings = [
    { timestamp: new Date("2026-01-01T00:00:00Z"), doorStatus: "closed" },
    { timestamp: new Date("2026-01-01T00:01:00Z"), doorStatus: "open" },
    { timestamp: new Date("2026-01-01T00:02:00Z"), doorStatus: "open" }
  ];
  const evaluated = [];
  const detectedIncidents = await replayTelemetryBatch(readings, {
    getDoorOpenSince: async reading => new Date(reading.timestamp.getTime() - 8_000),
    saveReading: async reading => {
      assert.equal(reading.isSimulated, true);
    },
    detectIncidents: async reading => {
      evaluated.push(reading.timestamp.toISOString());
      return reading.doorStatus === "open" ? [{ type: "door_open" }] : [];
    }
  });

  assert.equal(detectedIncidents, 2);
  assert.deepEqual(evaluated, readings.map(reading => reading.timestamp.toISOString()));
  assert.equal(readings[0].doorOpenSince, null);
});
