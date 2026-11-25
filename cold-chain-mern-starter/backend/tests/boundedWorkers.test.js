import test from "node:test";
import assert from "node:assert/strict";
import { runBoundedWorkers } from "../src/subjects/os/boundedWorkers.js";

test("bounded workers cap concurrency while retaining source order", async () => {
  let active = 0;
  let peak = 0;
  const results = await runBoundedWorkers([0, 1, 2, 3, 4], async (item, index) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, (4 - item) * 2));
    active -= 1;
    return `${index}:${item}`;
  }, 2);

  assert.equal(peak, 2);
  assert.deepEqual(results, ["0:0", "1:1", "2:2", "3:3", "4:4"]);
});

test("bounded workers reject invalid concurrency", async () => {
  await assert.rejects(runBoundedWorkers([], async () => {}, 0), RangeError);
});
