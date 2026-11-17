import mongoose from "mongoose";

const incidentSchema = new mongoose.Schema({
  shipmentId: { type: mongoose.Schema.Types.ObjectId, ref: "Shipment", required: true, index: true },
  detectedAt: { type: Date, required: true, default: Date.now, index: true },
  type: {
    type: String,
    enum: ["temperature_breach", "door_open", "low_fuel", "accident", "brake_problem", "other"],
    required: true,
    index: true
  },
  severity: { type: String, enum: ["low", "medium", "high", "critical"], required: true, index: true },
  status: {
    type: String,
    enum: ["new", "active", "acknowledged", "in_progress", "resolved", "closed"],
    default: "new",
    index: true
  },
  isSimulated: { type: Boolean, default: false, index: true },
  assignedTeamId: { type: mongoose.Schema.Types.ObjectId, ref: "Team", default: null, index: true },
  description: { type: String, default: "" },
  evidence: {
    temperature: { type: Number, default: null },
    doorStatus: { type: String, default: "" },
    fuelLevel: { type: Number, default: null },
    brakeStatus: { type: String, default: "" },
    telemetryRecordId: { type: mongoose.Schema.Types.ObjectId, ref: "TelemetryRecord", default: null }
  },
  resolvedAt: { type: Date, default: null },
  resolutionNote: { type: String, default: "" }
}, { timestamps: true });

incidentSchema.index({ shipmentId: 1, detectedAt: -1 });

export default mongoose.model("Incident", incidentSchema);
