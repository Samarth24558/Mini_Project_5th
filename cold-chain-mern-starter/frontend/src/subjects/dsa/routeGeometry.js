export const DEMO_ROUTES = [
  { id: "blr-mys", name: "Bengaluru → Mysuru", points: [[12.9716, 77.5946], [12.72, 77.45], [12.48, 77.14], [12.2958, 76.6394]] },
  { id: "chn-blr", name: "Chennai → Bengaluru", points: [[13.0827, 80.2707], [12.75, 79.72], [12.42, 79.12], [12.68, 78.35], [12.9716, 77.5946]] },
  { id: "hyd-vij", name: "Hyderabad → Vijayawada", points: [[17.385, 78.4867], [17.12, 79.38], [16.82, 80.08], [16.5062, 80.648]] },
  { id: "mum-pun", name: "Mumbai → Pune", points: [[19.076, 72.8777], [18.96, 73.18], [18.79, 73.48], [18.5204, 73.8567]] }
];

export function findDemoRoute(origin, destination) {
  return DEMO_ROUTES.find(route =>
    route.name === `${String(origin).trim()} → ${String(destination).trim()}`
  ) ?? null;
}

export function getRoutePosition(points, progress) {
  const distances = [0];
  for (let index = 1; index < points.length; index += 1) {
    const [startLat, startLon] = points[index - 1];
    const [endLat, endLon] = points[index];
    const radians = value => value * Math.PI / 180;
    const latitudeDelta = radians(endLat - startLat);
    const longitudeDelta = radians(endLon - startLon);
    const arc = Math.sin(latitudeDelta / 2) ** 2
      + Math.cos(radians(startLat)) * Math.cos(radians(endLat)) * Math.sin(longitudeDelta / 2) ** 2;
    distances.push(distances[index - 1] + 6371 * 2 * Math.atan2(Math.sqrt(arc), Math.sqrt(1 - arc)));
  }

  const targetDistance = Math.max(0, Math.min(1, progress)) * distances[distances.length - 1];
  let segmentIndex = distances.findIndex((distance, index) => index > 0 && distance >= targetDistance) - 1;
  if (segmentIndex < 0) segmentIndex = points.length - 2;
  const segmentDistance = distances[segmentIndex + 1] - distances[segmentIndex];
  const segmentProgress = segmentDistance
    ? (targetDistance - distances[segmentIndex]) / segmentDistance
    : 0;
  const start = points[segmentIndex];
  const end = points[segmentIndex + 1];
  return [
    start[0] + (end[0] - start[0]) * segmentProgress,
    start[1] + (end[1] - start[1]) * segmentProgress
  ];
}
