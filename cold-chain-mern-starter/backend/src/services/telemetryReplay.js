export async function replayTelemetryBatch(readings, { getDoorOpenSince, saveReading, detectIncidents }) {
  let detectedIncidents = 0;
  for (const reading of readings) {
    reading.doorOpenSince = reading.doorStatus === "open"
      ? await getDoorOpenSince(reading)
      : null;
    reading.isSimulated = true;
    await saveReading(reading);
    detectedIncidents += (await detectIncidents(reading)).length;
  }
  return detectedIncidents;
}
