import { Router } from "express";
import { syncProfile, getProfile } from "../controllers/userController.js";
import { requireAuth } from "../middleware/requireAuth.js";
const router = Router();
router.use(requireAuth);
router.post("/sync", syncProfile);
router.get("/me", getProfile);
export default router;
