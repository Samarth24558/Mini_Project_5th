import mongoose from "mongoose";

const auditLogSchema = new mongoose.Schema({
  incidentId: { type: mongoose.Schema.Types.ObjectId, ref: "Incident", required: true, index: true },
  alertEventId: { type: mongoose.Schema.Types.ObjectId, ref: "AlertEvent", default: null, index: true },
  action: { type: String, required: true, trim: true },
  actionBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  actionTime: { type: Date, default: Date.now, index: true },
  remarks: { type: String, default: "" },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { timestamps: true });

export default mongoose.model("AuditLog", auditLogSchema);
