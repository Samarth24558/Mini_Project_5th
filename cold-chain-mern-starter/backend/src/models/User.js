import mongoose from "mongoose";

const userSchema = new mongoose.Schema({
  clerkUserId: { type: String, required: true, unique: true, index: true },
  name: { type: String, trim: true, required: true },
  email: { type: String, trim: true, lowercase: true, required: true, index: true },
  phone: { type: String, trim: true, default: "" },
  role: {
    type: String,
    enum: ["fleet_manager", "driver", "action_team_member", "compliance_officer", "admin"],
    default: "driver",
    index: true
  },
  status: { type: String, enum: ["active", "inactive"], default: "active" }
}, { timestamps: true });

export default mongoose.model("User", userSchema);
