import test from "node:test";
import assert from "node:assert/strict";
import { getSimulationAlertType, SIMULATION_ALERT_SCHEDULE } from "../src/subjects/dsa/simulationAlertSchedule.js";

test("each simulation schedules exactly one alert for each response team", () => {
  assert.deepEqual(
    SIMULATION_ALERT_SCHEDULE.map(alert => alert.type),
    ["temperature_breach", "low_fuel", "brake_problem", "accident"]
  );
  assert.equal(new Set(SIMULATION_ALERT_SCHEDULE.map(alert => alert.tick)).size, 4);
  assert.equal(Array.from({ length: 30 }, (_, index) => getSimulationAlertType(index + 1)).filter(Boolean).length, 4);
});
