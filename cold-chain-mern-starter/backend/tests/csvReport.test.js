import test from "node:test";
import assert from "node:assert/strict";
import { csvCell, csvDocument } from "../src/services/csvReport.js";

test("CSV reports escape quotes and neutralize spreadsheet formulas", () => {
  assert.equal(csvCell('route "A"'), '"route ""A"""');
  assert.equal(csvCell(" =1+1"), `"' =1+1"`);
});

test("CSV documents use consistent CRLF row endings", () => {
  assert.equal(csvDocument(["name", "value"], [["truck", 4.5]]), '"name","value"\r\n"truck","4.5"');
});
