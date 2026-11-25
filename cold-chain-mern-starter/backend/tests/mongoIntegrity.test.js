import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import Incident from "../src/models/Incident.js";
import TelemetryRecord from "../src/models/TelemetryRecord.js";
import TeamAssignment from "../src/models/TeamAssignment.js";
import { withMongoTransaction } from "../src/services/recordDeletion.js";

function fakeSession() {
  const state = { committed: false, aborted: false, ended: false };
  return {
    state,
    async withTransaction(action) {
      try {
        await action();
        state.committed = true;
      } catch (error) {
        state.aborted = true;
        throw error;
      }
    },
    async endSession() {
      state.ended = true;
    }
  };
}

test("Mongo transaction wrapper commits and always releases the session", async () => {
  const session = fakeSession();
  const value = await withMongoTransaction(async transaction => {
    assert.equal(transaction, session);
    return "saved";
  }, async () => session);

  assert.equal(value, "saved");
  assert.equal(session.state.committed, true);
  assert.equal(session.state.aborted, false);
  assert.equal(session.state.ended, true);
});

test("Mongo transaction wrapper propagates failures and releases the session", async () => {
  const session = fakeSession();
  await assert.rejects(
    withMongoTransaction(async () => {
      throw new Error("write failed");
    }, async () => session),
    /write failed/
  );

  assert.equal(session.state.committed, false);
  assert.equal(session.state.aborted, true);
  assert.equal(session.state.ended, true);
});

test("Mongoose references and constrained values are validated before persistence", async () => {
  const incident = new Incident({ severity: "urgent", type: "unknown_event" });
  await assert.rejects(incident.validate());

  const telemetry = new TelemetryRecord({
    shipmentId: new mongoose.Types.ObjectId(),
    timestamp: new Date(),
    humidity: 101
  });
  await assert.rejects(telemetry.validate());

  const assignment = new TeamAssignment({
    incidentId: new mongoose.Types.ObjectId(),
    teamId: new mongoose.Types.ObjectId(),
    status: "unassigned"
  });
  await assert.rejects(assignment.validate());
});

test("telemetry-linked incidents have a unique idempotency index", () => {
  const idempotencyIndex = Incident.schema.indexes().find(([keys, options]) =>
    keys["evidence.telemetryRecordId"] === 1 && keys.type === 1 && options.unique
  );
  assert.ok(idempotencyIndex);
  assert.deepEqual(idempotencyIndex[1].partialFilterExpression, {
    "evidence.telemetryRecordId": { $type: "objectId" }
  });
});
