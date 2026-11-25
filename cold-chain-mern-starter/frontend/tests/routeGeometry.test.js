import test from "node:test";
import assert from "node:assert/strict";
import { DEMO_ROUTES, findDemoRoute, getRoutePosition, selectTrucksWithDistinctRoutes } from "../src/subjects/dsa/routeGeometry.js";

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

test("the simulated route is selected from the backend shipment endpoints", () => {
  assert.equal(findDemoRoute("Chennai", "Bengaluru")?.id, "chn-blr");
  assert.equal(findDemoRoute("Bengaluru", "Hyderabad")?.id, "blr-hyd");
  assert.equal(findDemoRoute(" Unknown ", "Route "), null);
  assert.equal(DEMO_ROUTES.length, 5);
  assert.equal(new Set(DEMO_ROUTES.map(route => route.id)).size, 5);
});

test("five selected demo trucks each have a different route", () => {
  const fleet = Array.from({ length: 20 }, (_, index) => {
    const [origin, destination] = DEMO_ROUTES[index % DEMO_ROUTES.length].name.split(" → ");
    return { truckId: String(index), origin, destination };
  });
  const selected = selectTrucksWithDistinctRoutes(fleet, () => 0);

  assert.equal(selected.length, 5);
  assert.equal(new Set(selected.map(truck => truck.truckId)).size, 5);
  assert.equal(new Set(selected.map(truck => findDemoRoute(truck.origin, truck.destination).id)).size, 5);
});
