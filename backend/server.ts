import "./config/env";
import app from "./app";
import { ENV } from "./config/env";

const PORT = ENV.PORT;
const HOST = ENV.HOST;

const server = app.listen(PORT, HOST, () => {
  console.log(`
╔════════════════════════════════════════════════════════╗
║               Reel-Saver Backend & Web                 ║
╠════════════════════════════════════════════════════════╣
║  Environment : ${ENV.NODE_ENV.padEnd(39)}║
║  Listening   : http://${HOST}:${PORT}${" ".repeat(Math.max(0, 31 - `${HOST}:${PORT}`.length))}║
║  API Base    : http://${HOST}:${PORT}/api${" ".repeat(Math.max(0, 27 - `${HOST}:${PORT}`.length))}║
╚════════════════════════════════════════════════════════╝
  `);
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
