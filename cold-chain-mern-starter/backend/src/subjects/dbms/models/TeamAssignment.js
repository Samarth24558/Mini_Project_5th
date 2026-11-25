import mongoose from "mongoose";

const teamAssignmentSchema = new mongoose.Schema({
  incidentId: { type: mongoose.Schema.Types.ObjectId, ref: "Incident", required: true, index: true },
  teamId: { type: mongoose.Schema.Types.ObjectId, ref: "Team", required: true, index: true },
  assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  assignedAt: { type: Date, default: Date.now },
  role: { type: String, enum: ["primary", "support"], default: "primary" },
  status: { type: String, enum: ["assigned", "accepted", "reassigned", "completed"], default: "assigned" },
  note: { type: String, default: "" }
}, { timestamps: true });

export default mongoose.model("TeamAssignment", teamAssignmentSchema);
