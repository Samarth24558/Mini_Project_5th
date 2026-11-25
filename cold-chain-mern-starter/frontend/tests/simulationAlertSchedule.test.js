import test from "node:test";
import assert from "node:assert/strict";
import { getSimulationAlertType, SIMULATION_ALERT_SCHEDULE, SIMULATION_TRUCKS_PER_RUN } from "../src/subjects/dsa/simulationAlertSchedule.js";

test("each truck schedules one alert for each response team in a five-truck simulation", () => {
  assert.deepEqual(
    SIMULATION_ALERT_SCHEDULE.map(alert => alert.type),
    ["temperature_breach", "low_fuel", "brake_problem", "accident"]
  );
  assert.equal(new Set(SIMULATION_ALERT_SCHEDULE.map(alert => alert.tick)).size, 4);
  assert.equal(Array.from({ length: 30 }, (_, index) => getSimulationAlertType(index + 1)).filter(Boolean).length, 4);
  assert.equal(SIMULATION_TRUCKS_PER_RUN, 5);
  assert.equal(SIMULATION_TRUCKS_PER_RUN * SIMULATION_ALERT_SCHEDULE.length, 20);
});
