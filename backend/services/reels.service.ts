import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { ENV } from "../config/env";
import * as reelRepo from "../repositories/reels.repository";
import * as categoryRepo from "../repositories/categories.repository";
import { extractReelContent, isInstagramReelUrl } from "./extraction.service";
import { analyzeReelContent } from "./ai.service";
import { convertMediaToMp3, deleteReelMediaFiles } from "./media.service";
import { transcribeAudioFile } from "./transcription.service";
import {
  enqueueReelProcessing,
  registerInProcessReelWorker,
} from "../jobs/reels.queue";
import type {
  CreateReelBody,
  ListReelsQuery,
  MediaFormatPreference,
  Reel,
  ReelWithCategory,
  UpdateReelBody,
} from "../types/reel.types";

export interface UploadedMediaInput {
  path: string;
  originalname: string;
  mimetype: string;
}

async function attachCategory(reel: Reel): Promise<ReelWithCategory> {
  if (!reel.categoryId) {
    return { ...reel, category: null };
  }

  const categories = await categoryRepo.listCategoriesByUser(reel.userId);
  const category = categories.find((item) => item.id === reel.categoryId) ?? null;

  return {
    ...reel,
    category: category ? { id: category.id, name: category.name } : null,
  };
}

export async function saveReel(
  userId: string,
  body: CreateReelBody,
  uploadedFile?: UploadedMediaInput | null
): Promise<ReelWithCategory> {
  const rawUrl = body.sourceUrl?.trim() ?? "";

  if (!rawUrl && !uploadedFile) {
    throw Object.assign(
      new Error(
        "Provide an Instagram Reel URL or upload an MP4/MP3 media file."
      ),
      { statusCode: 422 }
    );
  }

  if (rawUrl && !isInstagramReelUrl(rawUrl)) {
    throw Object.assign(
      new Error("sourceUrl must be a valid Instagram reel/post URL."),
      { statusCode: 422 }
    );
  }

  const sourceUrl =
    rawUrl || `upload://${uploadedFile?.originalname || "reel-media"}`;

  let categoryId: string | null = null;
  if (body.categoryName?.trim()) {
    const category = await categoryRepo.findOrCreateCategory(
      userId,
      body.categoryName.trim()
    );
    categoryId = category.id;
  }

  const clientTranscript = body.transcript?.trim() || null;
  const askBeforeConvert =
    body.askBeforeConvert === true || body.askBeforeConvert === "true";
  const mediaFormat: MediaFormatPreference = body.mediaFormat ?? "mp3";

  const shouldWaitConfirmation =
    askBeforeConvert && !uploadedFile && !clientTranscript;

  const reel = await reelRepo.createReel({
    id: randomUUID(),
    userId,
    sourceUrl,
    title: body.title?.trim() || null,
    authorHandle:
      body.authorHandle?.trim().replace(/^@/, "") || null,
    caption: body.caption?.trim() || null,
    thumbnailUrl: body.thumbnailUrl?.trim() || null,
    transcript: clientTranscript,
    notes: body.notes?.trim() || null,
    transcriptionSource: clientTranscript ? "client" : null,
    categoryId,
    initialStatus: shouldWaitConfirmation ? "AWAITING_CONFIRMATION" : "PENDING",
  });

  if (shouldWaitConfirmation) {
    // Lightweight metadata preview without downloading video/audio until user confirms
    setImmediate(() => {
      extractReelContent(sourceUrl, {
        existingAuthorHandle: reel.authorHandle,
        existingCaption: reel.caption,
        existingThumbnailUrl: reel.thumbnailUrl,
        mediaFormat: "skip",
      })
        .then(async (preview) => {
          if (preview.authorHandle || preview.caption || preview.thumbnailUrl) {
            await reelRepo.updateReelExtraction(reel.id, {
              authorHandle: reel.authorHandle ?? preview.authorHandle,
              caption: reel.caption ?? preview.caption,
              thumbnailUrl: reel.thumbnailUrl ?? preview.thumbnailUrl,
            });
          }
        })
        .catch(() => {
          // Ignore preview errors; full extraction runs after user confirms
        });
    });

    return attachCategory(reel);
  }

  await enqueueReelProcessing(reel.id, {
    uploadedFilePath: uploadedFile?.path ?? null,
    uploadedMimeType: uploadedFile?.mimetype ?? null,
    mediaFormat,
  });

  return attachCategory(reel);
}

export async function getReelForUser(
  userId: string,
  reelId: string
): Promise<ReelWithCategory> {
  const reel = await reelRepo.findReelById(reelId, userId);
  if (!reel) {
    throw Object.assign(new Error("Reel not found."), { statusCode: 404 });
  }

  return attachCategory(reel);
}

export async function listReelsForUser(
  userId: string,
  query: ListReelsQuery
): Promise<ReelWithCategory[]> {
  const [reels, categories] = await Promise.all([
    reelRepo.listReelsByUser(userId, {
      status: query.status,
      categoryId: query.categoryId,
      search: query.search,
    }),
    categoryRepo.listCategoriesByUser(userId),
  ]);

  const catMap = new Map(categories.map((c) => [c.id, c]));
  return reels.map((reel) => {
    const cat = reel.categoryId ? catMap.get(reel.categoryId) : null;
    return {
      ...reel,
      category: cat ? { id: cat.id, name: cat.name } : null,
    };
  });
}

/**
 * Background worker entry point:
 * PENDING -> EXTRACTING -> TRANSCRIBING -> SUMMARIZING -> DONE (or FAILED).
 */
export async function processReel(
  reelId: string,
  options?: {
    uploadedFilePath?: string | null;
    uploadedMimeType?: string | null;
    mediaFormat?: MediaFormatPreference;
    forceReprocess?: boolean;
  }
): Promise<void> {
  const reel = await reelRepo.findReelByIdUnscoped(reelId);
  if (!reel) {
    throw new Error(`Reel ${reelId} not found.`);
  }

  if (reel.status === "DONE" && !options?.forceReprocess) {
    return;
  }

  const mediaFormat: MediaFormatPreference = options?.mediaFormat ?? "mp3";

  try {
    // ─── Stage 1: Metadata & Auto Media Conversion (MP3 or MP4+MP3) ─────────
    await reelRepo.updateReelStatus(reelId, "EXTRACTING", null);

    const hasRealExistingTranscript = Boolean(
      reel.transcript &&
        reel.transcriptionSource !== "none" &&
        reel.transcriptionSource !== "caption-inferred"
    );

    const hasExistingSatisfiedMedia = Boolean(
      options?.uploadedFilePath ||
        (reel.audioUrl && (mediaFormat !== "mp4" || reel.videoUrl))
    );

    const extracted = await extractReelContent(reel.sourceUrl, {
      reelId,
      existingAuthorHandle: reel.authorHandle,
      existingCaption: reel.caption,
      existingThumbnailUrl: reel.thumbnailUrl,
      hasLocalMedia: hasExistingSatisfiedMedia,
      mediaFormat,
    });

    const authorHandle = reel.authorHandle ?? extracted.authorHandle;
    const caption = reel.caption ?? extracted.caption;
    let thumbnailUrl = reel.thumbnailUrl ?? extracted.thumbnailUrl;
    let audioUrl = reel.audioUrl;
    let videoUrl = reel.videoUrl;
    let audioDurationSec = reel.audioDurationSec;
    let audioDiskPath: string | null = null;

    const incomingMediaPath =
      options?.uploadedFilePath ?? extracted.resolvedMediaFilePath ?? null;

    if (incomingMediaPath && fs.existsSync(incomingMediaPath)) {
      const processedMedia = await convertMediaToMp3(
        reelId,
        incomingMediaPath,
        options?.uploadedMimeType ?? undefined,
        { keepVideoMp4: mediaFormat === "mp4" }
      );
      audioDiskPath = processedMedia.audioDiskPath;
      audioUrl = processedMedia.audioUrl ?? audioUrl;
      videoUrl = processedMedia.videoUrl ?? videoUrl;
      audioDurationSec = processedMedia.durationSec ?? audioDurationSec;
      thumbnailUrl = thumbnailUrl ?? processedMedia.thumbnailUrl;
    } else if (audioUrl) {
      const existingMp3 = path.join(ENV.UPLOADS_DIR, "audio", `${reelId}.mp3`);
      if (fs.existsSync(existingMp3)) {
        audioDiskPath = existingMp3;
      }
    }

    await reelRepo.updateReelExtraction(reelId, {
      authorHandle,
      caption,
      thumbnailUrl,
      audioUrl,
      videoUrl,
      audioDurationSec,
    });

    // ─── Stage 2: Audio Transcription (Card-Free Whisper / STT) ─────────────
    let spokenTranscript = hasRealExistingTranscript ? reel.transcript : null;
    let transcriptionSource = hasRealExistingTranscript
      ? reel.transcriptionSource
      : null;

    if (
      !spokenTranscript &&
      audioDiskPath &&
      mediaFormat !== "skip" &&
      ENV.ENABLE_VIDEO_TRANSCRIPTION
    ) {
      await reelRepo.updateReelStatus(reelId, "TRANSCRIBING", null);
      const sttResult = await transcribeAudioFile(audioDiskPath);
      if (sttResult && sttResult.transcript) {
        spokenTranscript = sttResult.transcript;
        transcriptionSource = sttResult.provider;
        await reelRepo.updateReelExtraction(reelId, {
          transcript: spokenTranscript,
          transcriptionSource,
        });
      }
    }

    // ─── Stage 3: AI Summary, Key Points & Category Assignment ──────────────
    await reelRepo.updateReelStatus(reelId, "SUMMARIZING", null);

    const existingUserCategories = await categoryRepo.listCategoriesByUser(
      reel.userId
    );
    const aiResult = await analyzeReelContent({
      spokenTranscript,
      caption,
      authorHandle,
      sourceUrl: reel.sourceUrl,
      userCategories: existingUserCategories.map((c) => c.name),
    });

    if (!spokenTranscript) {
      const fallbackTranscript =
        !caption && extracted.extractionHint
          ? `${extracted.extractionHint}`
          : aiResult.transcript;
      await reelRepo.updateReelExtraction(reelId, {
        transcript: fallbackTranscript,
        transcriptionSource: caption ? "caption-inferred" : "none",
      });
    } else {
      await reelRepo.updateReelExtraction(reelId, {
        transcript: aiResult.transcript,
        transcriptionSource: transcriptionSource ?? "client",
      });
    }

    // Preserve manual category selection if the user picked one at creation time
    let finalCategoryId = reel.categoryId;
    if (!finalCategoryId) {
      const category = await categoryRepo.findOrCreateCategory(
        reel.userId,
        aiResult.category
      );
      finalCategoryId = category.id;
    }

    await reelRepo.updateReelSummary(reelId, {
      title: reel.title ?? aiResult.title,
      summary: aiResult.summary,
      keyPoints: aiResult.keyPoints,
      categoryId: finalCategoryId,
      processedAt: new Date().toISOString(),
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unknown processing error.";
    await reelRepo.markReelFailed(reelId, message);
    throw err;
  }
}

export async function attachMediaToReel(
  userId: string,
  reelId: string,
  uploadedFile: UploadedMediaInput
): Promise<ReelWithCategory> {
  const reel = await reelRepo.findReelById(reelId, userId);
  if (!reel) {
    throw Object.assign(new Error("Reel not found."), { statusCode: 404 });
  }

  // Clear previously inferred transcript so the newly uploaded MP4/MP3 gets transcribed
  if (
    reel.transcriptionSource === "caption-inferred" ||
    reel.transcriptionSource === "none"
  ) {
    await reelRepo.updateReelExtraction(reelId, {
      transcript: null,
      transcriptionSource: null,
    });
  }

  await reelRepo.updateReelStatus(reelId, "PENDING", null);
  await enqueueReelProcessing(reelId, {
    uploadedFilePath: uploadedFile.path,
    uploadedMimeType: uploadedFile.mimetype,
  });

  const refreshed = await reelRepo.findReelById(reelId, userId);
  return attachCategory(refreshed ?? reel);
}

export async function updateReelCategory(
  userId: string,
  reelId: string,
  categoryName: string
): Promise<ReelWithCategory> {
  const reel = await reelRepo.findReelById(reelId, userId);
  if (!reel) {
    throw Object.assign(new Error("Reel not found."), { statusCode: 404 });
  }

  const trimmed = categoryName.trim();
  if (!trimmed) {
    const updated = await reelRepo.updateReelCategory(reelId, null);
    return { ...updated, category: null };
  }

  const category = await categoryRepo.findOrCreateCategory(userId, trimmed);
  const updated = await reelRepo.updateReelCategory(reelId, category.id);

  return { ...updated, category: { id: category.id, name: category.name } };
}

/**
 * Full user adjustment endpoint: allows editing title, summary, keyPoints,
 * transcript, notes, caption, authorHandle, and category, with optional AI re-summarization.
 */
export async function updateReelForUser(
  userId: string,
  reelId: string,
  body: UpdateReelBody
): Promise<ReelWithCategory> {
  const reel = await reelRepo.findReelById(reelId, userId);
  if (!reel) {
    throw Object.assign(new Error("Reel not found."), { statusCode: 404 });
  }

  const updates: Parameters<typeof reelRepo.updateReelFields>[1] = {};

  if (body.title !== undefined) updates.title = body.title?.trim() || null;
  if (body.authorHandle !== undefined) {
    updates.authorHandle = body.authorHandle?.trim().replace(/^@/, "") || null;
  }
  if (body.caption !== undefined) updates.caption = body.caption?.trim() || null;
  if (body.thumbnailUrl !== undefined) {
    updates.thumbnailUrl = body.thumbnailUrl?.trim() || null;
  }
  if (body.transcript !== undefined) {
    updates.transcript = body.transcript?.trim() || null;
  }
  if (body.summary !== undefined) updates.summary = body.summary?.trim() || null;
  if (body.notes !== undefined) updates.notes = body.notes?.trim() || null;
  if (body.keyPoints !== undefined) {
    updates.keyPoints = body.keyPoints
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
  }

  if (body.categoryName !== undefined) {
    const catName = body.categoryName?.trim() ?? "";
    if (!catName) {
      updates.categoryId = null;
    } else {
      const cat = await categoryRepo.findOrCreateCategory(userId, catName);
      updates.categoryId = cat.id;
    }
  } else if (body.categoryId !== undefined) {
    if (!body.categoryId) {
      updates.categoryId = null;
    } else {
      const cat = await categoryRepo.findCategoryById(body.categoryId, userId);
      if (!cat) {
        throw Object.assign(new Error("Selected category not found."), {
          statusCode: 404,
        });
      }
      updates.categoryId = cat.id;
    }
  }

  let updated = await reelRepo.updateReelFields(reelId, updates);

  if (body.resummarize) {
    const userCategories = await categoryRepo.listCategoriesByUser(userId);
    const aiResult = await analyzeReelContent({
      spokenTranscript: updated.transcript,
      caption: updated.caption,
      authorHandle: updated.authorHandle,
      sourceUrl: updated.sourceUrl,
      userCategories: userCategories.map((c) => c.name),
    });

    let catId = updated.categoryId;
    if (!catId) {
      const cat = await categoryRepo.findOrCreateCategory(
        userId,
        aiResult.category
      );
      catId = cat.id;
    }

    updated = await reelRepo.updateReelFields(reelId, {
      title: updated.title ?? aiResult.title,
      summary: aiResult.summary,
      keyPoints: aiResult.keyPoints,
      categoryId: catId,
      status: "DONE",
      errorMessage: null,
      processedAt: new Date().toISOString(),
    });
  }

  return attachCategory(updated);
}

export async function resummarizeReelForUser(
  userId: string,
  reelId: string
): Promise<ReelWithCategory> {
  const reel = await reelRepo.findReelById(reelId, userId);
  if (!reel) {
    throw Object.assign(new Error("Reel not found."), { statusCode: 404 });
  }

  const userCategories = await categoryRepo.listCategoriesByUser(userId);
  const aiResult = await analyzeReelContent({
    spokenTranscript: reel.transcript,
    caption: reel.caption,
    authorHandle: reel.authorHandle,
    sourceUrl: reel.sourceUrl,
    userCategories: userCategories.map((c) => c.name),
  });

  const cat = await categoryRepo.findOrCreateCategory(userId, aiResult.category);

  const updated = await reelRepo.updateReelFields(reelId, {
    title: aiResult.title,
    summary: aiResult.summary,
    keyPoints: aiResult.keyPoints,
    categoryId: reel.categoryId ?? cat.id,
    status: "DONE",
    errorMessage: null,
    processedAt: new Date().toISOString(),
  });

  return attachCategory(updated);
}

export async function confirmAndConvertReelForUser(
  userId: string,
  reelId: string,
  mediaFormat: MediaFormatPreference = "mp3"
): Promise<ReelWithCategory> {
  const reel = await reelRepo.findReelById(reelId, userId);
  if (!reel) {
    throw Object.assign(new Error("Reel not found."), { statusCode: 404 });
  }

  const isPlaceholderTitle =
    !reel.title || /^Saved (?:Instagram )?Reel/i.test(reel.title);
  const isPlaceholderTranscript =
    reel.transcriptionSource === "none" ||
    reel.transcriptionSource === "caption-inferred";

  await reelRepo.updateReelExtraction(reelId, {
    ...(isPlaceholderTitle ? { title: null } : {}),
    ...(isPlaceholderTranscript
      ? { transcript: null, transcriptionSource: null }
      : {}),
  });

  await reelRepo.updateReelStatus(reelId, "PENDING", null);
  await enqueueReelProcessing(reelId, { mediaFormat });

  const updated = await reelRepo.findReelById(reelId, userId);
  return attachCategory(updated ?? reel);
}

export async function retryReelForUser(
  userId: string,
  reelId: string,
  mediaFormat: MediaFormatPreference = "mp3"
): Promise<ReelWithCategory> {
  return confirmAndConvertReelForUser(userId, reelId, mediaFormat);
}

export async function deleteReelForUser(
  userId: string,
  reelId: string
): Promise<void> {
  const reel = await reelRepo.findReelById(reelId, userId);
  if (!reel) {
    throw Object.assign(new Error("Reel not found."), { statusCode: 404 });
  }

  await reelRepo.deleteReel(reelId, userId);
  deleteReelMediaFiles(reelId);
}

// Register background processor for single-process / Redis-free deployments
registerInProcessReelWorker(async (payload) => {
  await processReel(payload.reelId, {
    uploadedFilePath: payload.uploadedFilePath,
    uploadedMimeType: payload.uploadedMimeType,
    mediaFormat: payload.mediaFormat,
    forceReprocess: true,
  });
});
