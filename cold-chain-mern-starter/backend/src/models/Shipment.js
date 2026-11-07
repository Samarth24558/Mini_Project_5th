import mongoose from "mongoose";

const shipmentSchema = new mongoose.Schema({
  truckId: { type: mongoose.Schema.Types.ObjectId, ref: "Truck", required: true, index: true },
  origin: { type: String, trim: true, required: true },
  destination: { type: String, trim: true, required: true },
  status: {
    type: String,
    enum: ["scheduled", "in_transit", "delayed", "delivered", "cancelled"],
    default: "scheduled",
    index: true
  },
  departedAt: { type: Date, default: null },
  deliveredAt: { type: Date, default: null }
}, { timestamps: true });

export default mongoose.model("Shipment", shipmentSchema);
