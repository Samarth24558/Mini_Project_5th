import mongoose from "mongoose";

const truckSchema = new mongoose.Schema({
  driverName: { type: String, trim: true, required: true },
  plateNo: { type: String, trim: true, uppercase: true, required: true, unique: true, index: true },
  capacityKg: { type: Number, min: 0, required: true },
  status: { type: String, enum: ["active", "inactive", "maintenance"], default: "active", index: true }
}, { timestamps: true });

export default mongoose.model("Truck", truckSchema);
