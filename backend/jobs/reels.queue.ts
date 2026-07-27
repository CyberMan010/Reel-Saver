import { Queue } from "bullmq";
import { redisConnection } from "../config/redis";

export const REEL_PROCESSING_QUEUE = "reel-processing";

export const reelProcessingQueue = new Queue(REEL_PROCESSING_QUEUE, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: 100,
    removeOnFail: 500,
  },
});

export async function enqueueReelProcessing(reelId: string): Promise<void> {
  await reelProcessingQueue.add(
    "process-reel",
    { reelId },
    { jobId: reelId, removeOnComplete: true }
  );
}
