import mongoose from "mongoose";

const uploadSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  fileName: { type: String, required: true, trim: true },
  fileType: { type: String, enum: ["csv", "xlsx", "xls"], required: true },
  uploadTime: { type: Date, default: Date.now, index: true },
  status: {
    type: String,
    enum: ["uploaded", "validating", "processed", "partially_processed", "failed"],
    default: "uploaded",
    index: true
  },
  totalRows: { type: Number, min: 0, default: 0 },
  validRows: { type: Number, min: 0, default: 0 },
  rejectedRows: { type: Number, min: 0, default: 0 },
  simulationStatus: {
    type: String,
    enum: ["pending", "running", "completed"],
    default: "pending",
    index: true
  },
  simulationProcessedRows: { type: Number, min: 0, default: 0 },
  simulationIncidentTypes: { type: [String], default: [] },
  validationMessage: { type: String, default: "" }
}, { timestamps: true });

export default mongoose.model("Upload", uploadSchema);
