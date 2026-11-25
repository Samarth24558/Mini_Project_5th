import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SIMULATION_ROUTES, getDefaultSimulationRoute } from "../src/subjects/dsa/simulationRoutes.js";

test("demo fleet routes rotate across all configured routes", () => {
  const firstFleet = Array.from({ length: 20 }, (_, index) => getDefaultSimulationRoute(index));
  const uniqueRoutes = new Set(firstFleet.map(route => `${route.origin}\u0000${route.destination}`));

  assert.equal(uniqueRoutes.size, DEFAULT_SIMULATION_ROUTES.length);
  assert.deepEqual(firstFleet.slice(0, 4), DEFAULT_SIMULATION_ROUTES);
  assert.deepEqual(firstFleet.slice(4, 8), DEFAULT_SIMULATION_ROUTES);
});

test("default route selection rejects invalid indexes", () => {
  assert.throws(() => getDefaultSimulationRoute(-1), RangeError);
  assert.throws(() => getDefaultSimulationRoute(1.5), RangeError);
});
