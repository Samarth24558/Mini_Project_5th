import mongoose from "mongoose";

const telemetryRecordSchema = new mongoose.Schema({
  uploadId: { type: mongoose.Schema.Types.ObjectId, ref: "Upload", index: true },
  shipmentId: { type: mongoose.Schema.Types.ObjectId, ref: "Shipment", required: true, index: true },
  timestamp: { type: Date, required: true, index: true },
  temperature: { type: Number, default: null },
  humidity: { type: Number, min: 0, max: 100, default: null },
  doorStatus: { type: String, enum: ["open", "closed", "unknown"], default: "unknown" },
  fuelLevel: { type: Number, min: 0, max: 100, default: null },
  brakeStatus: { type: String, enum: ["normal", "warning", "failure", "unknown"], default: "unknown" },
  location: {
    latitude: { type: Number, min: -90, max: 90, default: null },
    longitude: { type: Number, min: -180, max: 180, default: null },
    label: { type: String, default: "" }
  },
  sourceData: { type: mongoose.Schema.Types.Mixed, default: null },
  sourceRowNumber: { type: Number, min: 1, default: null },
  isSimulated: { type: Boolean, default: true }
}, { timestamps: true });

telemetryRecordSchema.index({ shipmentId: 1, timestamp: -1 });
telemetryRecordSchema.index({ uploadId: 1, sourceRowNumber: 1 }, { sparse: true });

export default mongoose.model("TelemetryRecord", telemetryRecordSchema);
