import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import cookieParser from "cookie-parser";

import { ENV } from "./config/env";
import { generalRateLimiter } from "./middlewares/rateLimiter.middleware";
import { globalErrorHandler, notFoundHandler } from "./middlewares/error.middleware";
import apiRoutes from "./routes/index";

const app = express();

// ─── Security Headers ──────────────────────────────────────────────────────
app.use(helmet());

// ─── CORS ──────────────────────────────────────────────────────────────────
app.use(
  cors({
    origin: ENV.ALLOWED_ORIGINS,
    credentials: true,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// ─── Body Parsing ──────────────────────────────────────────────────────────
app.use(express.json({ limit: "10kb" })); // Prevent large payload attacks
app.use(express.urlencoded({ extended: true, limit: "10kb" }));
app.use(cookieParser());

// ─── Logging ───────────────────────────────────────────────────────────────
app.use(morgan(ENV.NODE_ENV === "production" ? "combined" : "dev"));

// ─── General Rate Limiting ─────────────────────────────────────────────────
app.use(generalRateLimiter);

// ─── API Routes ────────────────────────────────────────────────────────────
app.use("/api", apiRoutes);

// ─── 404 Handler ───────────────────────────────────────────────────────────
app.use(notFoundHandler);

// ─── Global Error Handler ──────────────────────────────────────────────────
app.use(globalErrorHandler);

export default app;
