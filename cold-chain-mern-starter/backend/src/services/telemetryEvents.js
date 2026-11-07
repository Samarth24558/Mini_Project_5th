import { EventEmitter } from "node:events";

const telemetryBus = new EventEmitter();
telemetryBus.setMaxListeners(0);

export function publishTelemetryEvent(payload) {
  telemetryBus.emit("telemetry", payload);
}

export function subscribeTelemetryEvents(listener) {
  telemetryBus.on("telemetry", listener);
  return () => telemetryBus.off("telemetry", listener);
}
