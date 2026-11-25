import { Router } from "express";
import { streamTelemetry } from "../controllers/streamController.js";
import { requireAuth } from "../middleware/requireAuth.js";
const router = Router();
router.get("/telemetry", requireAuth, streamTelemetry);
export default router;
