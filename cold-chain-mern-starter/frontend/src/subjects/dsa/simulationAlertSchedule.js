export const SIMULATION_TRUCKS_PER_RUN = 5;

export const SIMULATION_ALERT_SCHEDULE = [
  { tick: 5, type: "temperature_breach" },
  { tick: 10, type: "low_fuel" },
  { tick: 15, type: "brake_problem" },
  { tick: 20, type: "accident" }
];

export function getSimulationAlertType(tick) {
  return SIMULATION_ALERT_SCHEDULE.find(alert => alert.tick === tick)?.type ?? null;
}
