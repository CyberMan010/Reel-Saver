import net from "net";
import { Queue } from "bullmq";
import { ENV } from "../config/env";
import { redisConnection } from "../config/redis";

export const REEL_PROCESSING_QUEUE = "reel-processing";

export interface ReelJobPayload {
  reelId: string;
  uploadedFilePath?: string | null;
  uploadedMimeType?: string | null;
}

type LocalJobProcessor = (payload: ReelJobPayload) => Promise<void>;

let localProcessor: LocalJobProcessor | null = null;
let bullQueue: Queue | null = null;
let redisAvailableCache: boolean | null = null;

export function registerInProcessReelWorker(processor: LocalJobProcessor): void {
  localProcessor = processor;
}

async function checkRedisReachable(redisUrl: string): Promise<boolean> {
  if (!redisUrl) return false;
  try {
    const parsed = new URL(redisUrl);
    const host = parsed.hostname || "127.0.0.1";
    const port = Number(parsed.port || "6379");

    return await new Promise<boolean>((resolve) => {
      const socket = net.createConnection({ host, port });
      const done = (ok: boolean) => {
        socket.removeAllListeners();
        socket.destroy();
        resolve(ok);
      };
      socket.setTimeout(800);
      socket.once("connect", () => done(true));
      socket.once("timeout", () => done(false));
      socket.once("error", () => done(false));
    });
  } catch {
    return false;
  }
}

export async function isRedisQueueActive(): Promise<boolean> {
  if (ENV.QUEUE_MODE === "memory") return false;
  if (ENV.QUEUE_MODE === "redis") return Boolean(ENV.REDIS_URL);

  if (!ENV.REDIS_URL) return false;
  if (redisAvailableCache !== null) return redisAvailableCache;
  redisAvailableCache = await checkRedisReachable(ENV.REDIS_URL);
  return redisAvailableCache;
}

export function getBullQueue(): Queue {
  if (!bullQueue) {
    bullQueue = new Queue(REEL_PROCESSING_QUEUE, {
      connection: redisConnection,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    });
  }
  return bullQueue;
}

export async function enqueueReelProcessing(
  reelId: string,
  options?: { uploadedFilePath?: string | null; uploadedMimeType?: string | null }
): Promise<void> {
  const payload: ReelJobPayload = {
    reelId,
    uploadedFilePath: options?.uploadedFilePath ?? null,
    uploadedMimeType: options?.uploadedMimeType ?? null,
  };

  if (await isRedisQueueActive()) {
    const queue = getBullQueue();
    await queue.add("process-reel", payload, {
      jobId: `${reelId}-${Date.now()}`,
      removeOnComplete: true,
    });
    return;
  }

  // Reliable in-process async background execution when Redis is not configured
  setImmediate(() => {
    if (!localProcessor) {
      console.error(
        `[Queue] No in-process worker registered for reel ${reelId}.`
      );
      return;
    }
    localProcessor(payload).catch((err) => {
      console.error(
        `[Queue] In-process processing failed for reel ${reelId}:`,
        err instanceof Error ? err.message : err
      );
    });
  });
}
