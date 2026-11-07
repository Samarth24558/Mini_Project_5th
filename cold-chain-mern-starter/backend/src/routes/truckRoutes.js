import { Router } from "express";
import { createTruck, getTrucks, updateTruck, deleteTruck } from "../controllers/truckController.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireRole } from "../middleware/requireRole.js";
const router = Router();
router.use(requireAuth);
router.route("/").get(getTrucks).post(requireRole("fleet_manager", "admin"), createTruck);
router.route("/:id").patch(requireRole("fleet_manager", "admin"), updateTruck).delete(requireRole("fleet_manager", "admin"), deleteTruck);
export default router;
