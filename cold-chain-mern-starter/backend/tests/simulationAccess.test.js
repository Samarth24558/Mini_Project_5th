import test from "node:test";
import assert from "node:assert/strict";
import { hasSimulationAccess } from "../src/middleware/requireRole.js";

test("fleet managers and administrators can always run simulations", () => {
  assert.equal(hasSimulationAccess({ status: "active", role: "fleet_manager" }), true);
  assert.equal(hasSimulationAccess({ status: "active", role: "admin" }), true);
});

test("a manager-granted permission allows an active assigned user to simulate", () => {
  assert.equal(hasSimulationAccess({ status: "active", role: "driver", canRunSimulation: true }), true);
  assert.equal(hasSimulationAccess({ status: "active", role: "driver", canRunSimulation: false }), false);
});

test("pending and inactive users cannot run simulations even if permission is set", () => {
  assert.equal(hasSimulationAccess({ status: "active", role: "pending_assignment", canRunSimulation: true }), false);
  assert.equal(hasSimulationAccess({ status: "inactive", role: "driver", canRunSimulation: true }), false);
});
