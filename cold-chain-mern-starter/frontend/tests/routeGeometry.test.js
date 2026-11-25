import test from "node:test";
import assert from "node:assert/strict";
import { getRoutePosition } from "../src/subjects/dsa/routeGeometry.js";

test("route interpolation returns endpoints and clamps progress", () => {
  const points = [[0, 0], [0, 2]];
  assert.deepEqual(getRoutePosition(points, 0), [0, 0]);
  assert.deepEqual(getRoutePosition(points, 1), [0, 2]);
  assert.deepEqual(getRoutePosition(points, -1), [0, 0]);
  assert.deepEqual(getRoutePosition(points, 2), [0, 2]);
});

test("route interpolation advances by distance across route segments", () => {
  const points = [[0, 0], [0, 1], [0, 3]];
  const position = getRoutePosition(points, 0.5);
  assert.ok(Math.abs(position[0]) < 1e-9);
  assert.ok(Math.abs(position[1] - 1.5) < 1e-6);
});
