import mongoose from "mongoose";
import Truck from "../../dbms/models/Truck.js";
import Shipment from "../../dbms/models/Shipment.js";
import { deleteShipmentBranch, withDeletionTransaction } from "../../dbms/recordDeletion.js";

export async function getTrucks(req, res) {
  try {
    const { status } = req.query;
    const filter = {};
    if (status) filter.status = status;
    const trucks = await Truck.find(filter).sort({ plateNo: 1 });
    return res.status(200).json({ success: true, count: trucks.length, data: trucks });
  } catch (error) {
    console.error("getTrucks:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch trucks" });
  }
}

export async function createTruck(req, res) {
  try {
    const { driverName, plateNo, capacityKg, status } = req.body;
    if (!driverName?.trim() || !plateNo?.trim() || capacityKg === undefined) {
      return res.status(400).json({
        success: false,
        message: "driverName, plateNo and capacityKg are required"
      });
    }
    const truck = await Truck.create({
      driverName: driverName.trim(),
      plateNo: plateNo.trim().toUpperCase(),
      capacityKg,
      ...(status ? { status } : {})
    });
    return res.status(201).json({ success: true, message: "Truck created successfully", data: truck });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ success: false, message: "A truck with this plate number already exists" });
    }
    if (error.name === "ValidationError" || error.name === "CastError") {
      return res.status(400).json({ success: false, message: error.message });
    }
    console.error("createTruck:", error);
    return res.status(500).json({ success: false, message: "Failed to create truck" });
  }
}

export async function updateTruck(req, res) {
  try {
    const updates = {};
    for (const key of ["driverName", "plateNo", "capacityKg", "status"]) {
      if (Object.hasOwn(req.body, key)) updates[key] = req.body[key];
    }
    if (updates.plateNo) updates.plateNo = String(updates.plateNo).trim().toUpperCase();
    if (updates.driverName) updates.driverName = String(updates.driverName).trim();
    if (updates.status && updates.status !== "active") {
      const Shipment = (await import("../../dbms/models/Shipment.js")).default;
      const activeShipment = await Shipment.exists({ truckId: req.params.id, status: "in_transit" });
      if (activeShipment) return res.status(409).json({ success: false, message: "Truck is on an in-transit shipment and cannot be taken out of service" });
    }
    const truck = await Truck.findByIdAndUpdate(req.params.id, updates, { new: true, runValidators: true });
    if (!truck) return res.status(404).json({ success: false, message: "Truck not found" });
    res.json({ success: true, data: truck });
  } catch (error) {
    res.status(error.code === 11000 ? 409 : 400).json({ success: false, message: error.code === 11000 ? "Registration number already exists" : error.message });
  }
}

export async function deleteTruck(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid truck ID" });
    const result = await withDeletionTransaction(async session => {
      const truck = await Truck.findById(req.params.id).session(session);
      if (!truck) return null;
      const shipmentIds = await Shipment.find({ truckId: truck._id }).distinct("_id").session(session);
      const deleted = await deleteShipmentBranch(shipmentIds, session);
      await Truck.deleteOne({ _id: truck._id }, { session });
      return { plateNo: truck.plateNo, ...deleted };
    });
    if (!result) return res.status(404).json({ success: false, message: "Truck not found" });
    return res.json({ success: true, message: "Truck and linked operational history deleted", data: result });
  } catch (error) {
    console.error("deleteTruck:", error);
    return res.status(500).json({ success: false, message: "Failed to delete truck and linked records" });
  }
}
