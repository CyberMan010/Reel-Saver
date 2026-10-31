import { Router } from "express";
import authRoutes from "./auth.routes";
import reelsRoutes from "./reels.routes";
import categoriesRoutes from "./categories.routes";
import { ENV, isSupabaseConfigured } from "../config/env";
import { isRedisQueueActive } from "../jobs/reels.queue";
import { isFfmpegAvailable } from "../services/media.service";
import { isLocalWhisperInstalled } from "../services/transcription.service";

const router = Router();

router.use("/auth", authRoutes);
router.use("/reels", reelsRoutes);
router.use("/categories", categoriesRoutes);

router.get("/health", (_req, res) => {
  res.json({
    success: true,
    message: "Server is healthy.",
    timestamp: new Date().toISOString(),
  });
});

router.get("/system/capabilities", async (_req, res) => {
  const [ffmpegReady, localWhisperReady, redisActive] = await Promise.all([
    isFfmpegAvailable(),
    isLocalWhisperInstalled(),
    isRedisQueueActive(),
  ]);

  res.json({
    success: true,
    data: {
      storageMode: isSupabaseConfigured() ? "supabase" : "local-json",
      queueMode: redisActive ? "bullmq-redis" : "in-process-async",
      ffmpegAvailable: ffmpegReady,
      transcription: {
        preferred: ENV.TRANSCRIPTION_PROVIDER,
        groqWhisperConfigured: Boolean(ENV.GROQ_API_KEY),
        geminiAudioConfigured: Boolean(ENV.GEMINI_API_KEY),
        localWhisperInstalled: localWhisperReady,
        clientSpeechSupported: true,
      },
      aiSummarizer: {
        preferred: ENV.AI_PROVIDER,
        groqConfigured: Boolean(ENV.GROQ_API_KEY),
        geminiConfigured: Boolean(ENV.GEMINI_API_KEY),
        anthropicConfigured: Boolean(ENV.ANTHROPIC_API_KEY),
        localFallbackReady: true,
      },
      ipProtectionMode:
        "client-edge-metadata + direct-mp4-mp3-upload + official-oembed",
    },
  });
});

export default router;
