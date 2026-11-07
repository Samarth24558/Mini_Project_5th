import Truck from "../models/Truck.js";

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
      const Shipment = (await import("../models/Shipment.js")).default;
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
    const Shipment = (await import("../models/Shipment.js")).default;
    const inUse = await Shipment.exists({ truckId: req.params.id });
    if (inUse) return res.status(409).json({ success: false, message: "This truck has shipment history and cannot be deleted. Change its status to maintenance or inactive instead." });
    const truck = await Truck.findByIdAndDelete(req.params.id);
    if (!truck) return res.status(404).json({ success: false, message: "Truck not found" });
    res.json({ success: true, message: "Truck deleted" });
  } catch (error) { res.status(400).json({ success: false, message: error.message }); }
}
