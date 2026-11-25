import test from "node:test";
import assert from "node:assert/strict";
import { canTransitionIncidentStatus } from "../src/subjects/webTechnology/controllers/incidentController.js";

test("incident workflow permits forward response and resolution transitions", () => {
  assert.equal(canTransitionIncidentStatus("new", "acknowledged"), true);
  assert.equal(canTransitionIncidentStatus("active", "in_progress"), true);
  assert.equal(canTransitionIncidentStatus("acknowledged", "in_progress"), true);
  assert.equal(canTransitionIncidentStatus("in_progress", "resolved"), true);
  assert.equal(canTransitionIncidentStatus("resolved", "closed"), true);
  assert.equal(canTransitionIncidentStatus("active", "active"), true);
});

test("incident workflow rejects reopening resolved or closed incidents", () => {
  assert.equal(canTransitionIncidentStatus("new", "resolved"), false);
  assert.equal(canTransitionIncidentStatus("active", "resolved"), false);
  assert.equal(canTransitionIncidentStatus("resolved", "in_progress"), false);
  assert.equal(canTransitionIncidentStatus("closed", "active"), false);
  assert.equal(canTransitionIncidentStatus("new", "invalid"), false);
});
