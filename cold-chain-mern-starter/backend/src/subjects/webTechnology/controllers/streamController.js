import { subscribeTelemetryEvents } from "../services/telemetryEvents.js";

export function streamTelemetry(req, res) {
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();
  res.write(": connected\n\n");

  const unsubscribe = subscribeTelemetryEvents(payload => {
    res.write(`event: telemetry\ndata: ${JSON.stringify(payload)}\n\n`);
  });
  const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), 25_000);
  req.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
}
