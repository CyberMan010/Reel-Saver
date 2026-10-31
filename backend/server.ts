import "./config/env";
import app from "./app";
import { ENV } from "./config/env";
import { isRedisQueueActive } from "./jobs/reels.queue";
import {
  getStorageStatusSummary,
  probeSupabaseHealth,
} from "./storage/storageManager";

const PORT = ENV.PORT;
const HOST = ENV.HOST;

const server = app.listen(PORT, HOST, () => {
  console.log(`
╔════════════════════════════════════════════════════════╗
║               Reel-Saver Backend & Web                 ║
╠════════════════════════════════════════════════════════╣
║  Environment : ${ENV.NODE_ENV.padEnd(39)}║
║  Web App UI  : http://localhost:${String(PORT).padEnd(23)}║
║  API Base    : http://localhost:${PORT}/api${" ".repeat(Math.max(0, 19 - String(PORT).length))}║
╚════════════════════════════════════════════════════════╝
  `);

  // Non-blocking startup probe so the first user login/register is instant
  void (async () => {
    await probeSupabaseHealth();
    const storage = getStorageStatusSummary();
    const redisActive = await isRedisQueueActive();
    console.log(
      `[Startup] Storage: ${storage.activeBackend} | Queue: ${
        redisActive ? "bullmq-redis" : "in-process-async (no Redis needed)"
      }`
    );
  })();
});

function gracefulShutdown(signal: string) {
  console.log(`\n[Server] ${signal} received. Shutting down gracefully...`);
  server.close(() => {
    console.log("[Server] HTTP server closed.");
    process.exit(0);
  });
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

process.on("unhandledRejection", (reason) => {
  console.error("[Server] Unhandled Promise Rejection:", reason);
});

process.on("uncaughtException", (err) => {
  console.error("[Server] Uncaught Exception:", err);
  gracefulShutdown("UNCAUGHT_EXCEPTION");
});
