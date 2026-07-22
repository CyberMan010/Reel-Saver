import "./config/env"; // Load env vars first
import app from "./app";
import { ENV } from "./config/env";

const PORT = ENV.PORT;

const server = app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════╗
║          🚀  Express + Supabase Auth Server             ║
╠════════════════════════════════════════════════════════╣
║  Environment : ${ENV.NODE_ENV.padEnd(39)}║
║  Port        : ${String(PORT).padEnd(39)}║
║  API Base    : http://localhost:${PORT}/api${" ".repeat(26 - String(PORT).length)}║
╚════════════════════════════════════════════════════════╝
  `);
});

// ─── Graceful Shutdown ──────────────────────────────────────────────────────
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
  gracefulShutdown("UNHANDLED_REJECTION");
});

process.on("uncaughtException", (err) => {
  console.error("[Server] Uncaught Exception:", err);
  gracefulShutdown("UNCAUGHT_EXCEPTION");
});
