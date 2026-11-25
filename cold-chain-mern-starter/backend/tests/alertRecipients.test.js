import test from "node:test";
import assert from "node:assert/strict";
import { getAlertRecipients } from "../src/subjects/webTechnology/services/alertRecipients.js";

test("alerts go only to the assigned team's email", () => {
  assert.deepEqual(getAlertRecipients({
    assignedTeamEmail: " Team@example.com "
  }), ["team@example.com"]);
  assert.deepEqual(getAlertRecipients({}), []);
});
