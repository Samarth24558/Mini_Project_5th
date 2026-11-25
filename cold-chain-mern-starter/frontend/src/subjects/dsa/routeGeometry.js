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
