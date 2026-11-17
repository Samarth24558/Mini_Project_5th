import mongoose from "mongoose";
import Shipment from "../models/Shipment.js";
import Truck from "../models/Truck.js";
import { deleteShipmentBranch, withDeletionTransaction } from "../services/recordDeletion.js";

const shipmentStatuses = ["scheduled", "in_transit", "delayed", "delivered", "cancelled"];

export async function createShipment(req, res) {
  try {
    const { truckId, origin, destination, status } = req.body;

    if (!truckId || !origin?.trim() || !destination?.trim()) {
      return res.status(400).json({
        success: false,
        message: "truckId, origin and destination are required"
      });
    }

    if (!mongoose.isValidObjectId(truckId)) {
      return res.status(400).json({ success: false, message: "Invalid truckId" });
    }

    const truck = await Truck.findById(truckId);
    if (!truck) {
      return res.status(404).json({ success: false, message: "Selected truck was not found" });
    }
    if (truck.status !== "active") {
      return res.status(400).json({ success: false, message: "Only active trucks can be assigned to a new shipment" });
    }

    if (status && !shipmentStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Allowed values: ${shipmentStatuses.join(", ")}`
      });
    }

    const shipment = await Shipment.create({
      truckId,
      origin: origin.trim(),
      destination: destination.trim(),
      ...(status ? { status } : {})
    });

    const result = await Shipment.findById(shipment._id).populate("truckId");
    return res.status(201).json({
      success: true,
      message: "Shipment created successfully",
      data: result
    });
  } catch (error) {
    console.error("createShipment:", error);
    if (error.name === "ValidationError" || error.name === "CastError") {
      return res.status(400).json({ success: false, message: error.message });
    }
    return res.status(500).json({ success: false, message: "Failed to create shipment" });
  }
}

export async function getShipments(req, res) {
  try {
    const { status, truckId, search } = req.query;
    const filter = {};

    if (status) {
      if (!shipmentStatuses.includes(status)) {
        return res.status(400).json({ success: false, message: "Invalid shipment status filter" });
      }
      filter.status = status;
    }
    if (truckId) {
      if (!mongoose.isValidObjectId(truckId)) {
        return res.status(400).json({ success: false, message: "Invalid truckId filter" });
      }
      filter.truckId = truckId;
    }
    if (search?.trim()) {
      const term = search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      filter.$or = [
        { origin: { $regex: term, $options: "i" } },
        { destination: { $regex: term, $options: "i" } }
      ];
    }

    const shipments = await Shipment.find(filter)
      .populate("truckId", "driverName plateNo capacityKg status")
      .sort({ createdAt: -1 });

    return res.status(200).json({ success: true, count: shipments.length, data: shipments });
  } catch (error) {
    console.error("getShipments:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch shipments" });
  }
}

export async function getShipmentById(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid shipment ID" });
    }
    const shipment = await Shipment.findById(req.params.id)
      .populate("truckId", "driverName plateNo capacityKg status");
    if (!shipment) return res.status(404).json({ success: false, message: "Shipment not found" });
    return res.status(200).json({ success: true, data: shipment });
  } catch (error) {
    console.error("getShipmentById:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch shipment" });
  }
}

export async function updateShipment(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid shipment ID" });
    }

    const allowedFields = ["truckId", "origin", "destination", "status"];
    const updates = {};
    for (const field of allowedFields) {
      if (Object.hasOwn(req.body, field)) updates[field] = req.body[field];
    }
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ success: false, message: "Provide at least one field to update" });
    }

    if (updates.truckId) {
      if (!mongoose.isValidObjectId(updates.truckId)) {
        return res.status(400).json({ success: false, message: "Invalid truckId" });
      }
      const truck = await Truck.findById(updates.truckId);
      if (!truck) return res.status(404).json({ success: false, message: "Selected truck was not found" });
      if (truck.status !== "active") {
        return res.status(400).json({ success: false, message: "Only active trucks can be assigned" });
      }
    }
    if (updates.status && !shipmentStatuses.includes(updates.status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Allowed values: ${shipmentStatuses.join(", ")}`
      });
    }
    if (updates.origin !== undefined) updates.origin = updates.origin.trim();
    if (updates.destination !== undefined) updates.destination = updates.destination.trim();

    const current = await Shipment.findById(req.params.id);
    if (!current) return res.status(404).json({ success: false, message: "Shipment not found" });

    if (updates.status === "in_transit" && !current.departedAt) updates.departedAt = new Date();
    if (updates.status === "delivered" && !current.deliveredAt) updates.deliveredAt = new Date();
    if (updates.status && updates.status !== "delivered") updates.deliveredAt = null;

    const shipment = await Shipment.findByIdAndUpdate(req.params.id, updates, {
      new: true,
      runValidators: true
    }).populate("truckId", "driverName plateNo capacityKg status");

    return res.status(200).json({
      success: true,
      message: "Shipment updated successfully",
      data: shipment
    });
  } catch (error) {
    console.error("updateShipment:", error);
    if (error.name === "ValidationError" || error.name === "CastError") {
      return res.status(400).json({ success: false, message: error.message });
    }
    return res.status(500).json({ success: false, message: "Failed to update shipment" });
  }
}

export async function deleteShipment(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid shipment ID" });
    }
    const result = await withDeletionTransaction(session => deleteShipmentBranch([req.params.id], session));
    if (!result.shipments) return res.status(404).json({ success: false, message: "Shipment not found" });
    return res.status(200).json({ success: true, message: "Shipment and linked operational history deleted", data: result });
  } catch (error) {
    console.error("deleteShipment:", error);
    return res.status(500).json({ success: false, message: "Failed to delete shipment" });
  }
}
