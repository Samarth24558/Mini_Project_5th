import mongoose from "mongoose";

const teamSchema = new mongoose.Schema({
  teamName: { type: String, trim: true, required: true, unique: true, index: true },
  teamType: {
    type: String,
    enum: ["cold_chain", "fuel_support", "emergency_response", "maintenance", "general"],
    default: "general",
    index: true
  },
  description: { type: String, default: "" },
  contactInfo: {
    email: { type: String, trim: true, lowercase: true, default: "" },
    phone: { type: String, trim: true, default: "" }
  },
  memberUserIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  status: { type: String, enum: ["active", "inactive"], default: "active" }
}, { timestamps: true });

export default mongoose.model("Team", teamSchema);
