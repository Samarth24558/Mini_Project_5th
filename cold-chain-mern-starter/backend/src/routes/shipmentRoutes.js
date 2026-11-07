import { Router } from "express";
import {
  createShipment,
  getShipments,
  getShipmentById,
  updateShipment,
  deleteShipment
} from "../controllers/shipmentController.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireRole } from "../middleware/requireRole.js";

const router = Router();

router.use(requireAuth);
router.route("/")
  .post(requireRole("fleet_manager", "admin"), createShipment)
  .get(getShipments);
router.route("/:id")
  .get(getShipmentById)
  .put(requireRole("fleet_manager", "admin"), updateShipment)
  .delete(requireRole("fleet_manager", "admin"), deleteShipment);

export default router;
