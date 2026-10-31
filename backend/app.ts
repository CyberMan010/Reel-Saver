import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import path from "path";

import { ENV } from "./config/env";
import { ensureUploadDirs } from "./services/media.service";
import { generalRateLimiter } from "./middlewares/rateLimiter.middleware";
import {
  globalErrorHandler,
  notFoundHandler,
} from "./middlewares/error.middleware";
import apiRoutes from "./routes/index";

const app = express();

app.set("trust proxy", 1);

ensureUploadDirs();

// ─── Security Headers (configured for mobile + iframe preview compatibility) ──
app.use(
  helmet({
    frameguard: false,
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);

// ─── CORS (permits Flutter mobile clients, configured origins & preview hosts) ─
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) {
        callback(null, true);
        return;
      }
      if (
        ENV.ALLOWED_ORIGINS.includes("*") ||
        ENV.ALLOWED_ORIGINS.includes(origin) ||
        /\.e2b\.app$/i.test(new URL(origin).hostname) ||
        /^localhost$|^127\.0\.0\.1$/.test(new URL(origin).hostname)
      ) {
        callback(null, true);
        return;
      }
      callback(null, true);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// ─── Body Parsing ──────────────────────────────────────────────────────────
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));
app.use(cookieParser());

// ─── Logging ───────────────────────────────────────────────────────────────
if (ENV.NODE_ENV !== "test") {
  app.use(morgan(ENV.NODE_ENV === "production" ? "combined" : "dev"));
}

// ─── Static Assets: Converted MP3/Thumbnails + Web Companion App ──────────
app.use("/uploads", express.static(ENV.UPLOADS_DIR));

const publicDir = path.resolve(__dirname, "public");
app.use(express.static(publicDir));

// ─── API Rate Limiting & Routes (disable ETag/caching so live polling is fresh) ─
app.use(
  "/api",
  (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    next();
  },
  generalRateLimiter,
  apiRoutes
);

// ─── SPA Fallback for Web Companion App ───────────────────────────────────
app.get("/{*splat}", (req, res, next) => {
  if (req.path.startsWith("/api") || req.path.startsWith("/uploads")) {
    next();
    return;
  }
  res.sendFile(path.join(publicDir, "index.html"), (err) => {
    if (err) next();
  });
});

// ─── 404 & Global Error Handler ───────────────────────────────────────────
app.use(notFoundHandler);
app.use(globalErrorHandler);

export default app;
