import mongoose from "mongoose";

const alertEventSchema = new mongoose.Schema({
  incidentId: { type: mongoose.Schema.Types.ObjectId, ref: "Incident", required: true, index: true },

  alertType: { type: String, required: true, trim: true },

  message: { type: String, required: true },

  recipients: [{ type: String, trim: true, lowercase: true }],

  channel: { type: String, enum: ["email", "dashboard", "both"], default: "both" },

  status: {
    type: String,
    enum: ["pending", "sent", "failed", "partially_sent"],
    default: "pending",
    index: true
  },

  providerMessageId: { type: String, default: "" },

  sentAt: { type: Date, default: null },

  errorMessage: { type: String, default: "" }
  
}, { timestamps: true });

export default mongoose.model("AlertEvent", alertEventSchema);
