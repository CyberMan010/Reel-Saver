import "./config/env";
import { Worker } from "bullmq";
import { redisConnection } from "./config/redis";
import { REEL_PROCESSING_QUEUE } from "./jobs/reels.queue";
import { processReel } from "./services/reels.service";

const worker = new Worker(
  REEL_PROCESSING_QUEUE,
  async (job) => {
    const { reelId } = job.data as { reelId: string };
    console.log(`[Worker] Processing reel ${reelId} (attempt ${job.attemptsMade + 1})`);
    await processReel(reelId);
    console.log(`[Worker] Reel ${reelId} processed successfully.`);
  },
  { connection: redisConnection }
);

worker.on("failed", (job, err) => {
  console.error(`[Worker] Job ${job?.id ?? "unknown"} failed:`, err.message);
});

worker.on("error", (err) => {
  console.error("[Worker] Worker error:", err);
});

console.log(`[Worker] Listening on queue "${REEL_PROCESSING_QUEUE}"`);

async function shutdown(signal: string) {
  console.log(`\n[Worker] ${signal} received. Closing worker...`);
  await worker.close();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
