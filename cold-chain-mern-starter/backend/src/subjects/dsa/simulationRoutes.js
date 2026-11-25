export const DEFAULT_SIMULATION_ROUTES = [
  { origin: "Bengaluru", destination: "Mysuru" },
  { origin: "Chennai", destination: "Bengaluru" },
  { origin: "Hyderabad", destination: "Vijayawada" },
  { origin: "Mumbai", destination: "Pune" }
];

export function getDefaultSimulationRoute(index) {
  if (!Number.isInteger(index) || index < 0) {
    throw new RangeError("Simulation route index must be a non-negative integer");
  }
  return DEFAULT_SIMULATION_ROUTES[index % DEFAULT_SIMULATION_ROUTES.length];
}
