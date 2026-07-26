import { Router } from "express";
import authRoutes from "./auth.routes";
import reelsRoutes from "./reels.routes";

const router = Router();

// Mount auth routes
router.use("/auth", authRoutes);

// Mount reel routes
router.use("/reels", reelsRoutes);

// Health check
router.get("/health", (_req, res) => {
  res.json({
    success: true,
    message: "Server is healthy.",
    timestamp: new Date().toISOString(),
  });
});

export default router;
