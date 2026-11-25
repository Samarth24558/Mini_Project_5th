import { Router } from "express";
import { exportReport } from "../controllers/reportController.js";
import { requireAuth } from "../middleware/requireAuth.js";
const router = Router();
router.use(requireAuth);
router.get("/export", exportReport);
export default router;
