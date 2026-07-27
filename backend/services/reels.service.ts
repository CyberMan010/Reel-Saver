import { randomUUID } from "crypto";
import * as reelRepo from "../repositories/reels.repository";
import * as categoryRepo from "../repositories/categories.repository";
import { extractReelContent, isInstagramReelUrl } from "./extraction.service";
import { summarizeReelCaption } from "./ai.service";
import type { CreateReelBody, ListReelsQuery, Reel, ReelWithCategory } from "../types/reel.types";
import { enqueueReelProcessing } from "../jobs/reels.queue";

export async function saveReel(userId: string, body: CreateReelBody): Promise<Reel> {
  const sourceUrl = body.sourceUrl.trim();

  if (!isInstagramReelUrl(sourceUrl)) {
    throw Object.assign(new Error("sourceUrl must be a valid Instagram reel/post URL."), {
      statusCode: 422,
    });
  }

  const reel = await reelRepo.createReel({
    id: randomUUID(),
    userId,
    sourceUrl,
  });

  await enqueueReelProcessing(reel.id);

  return reel;
}

export async function getReelForUser(userId: string, reelId: string): Promise<ReelWithCategory> {
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
  const reels = await reelRepo.listReelsByUser(userId, {
    status: query.status,
    categoryId: query.categoryId,
  });

  return Promise.all(reels.map(attachCategory));
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

/**
 * Background worker entry point — PENDING → EXTRACTING → SUMMARIZING → DONE.
 * Failures mark the reel FAILED and re-throw for BullMQ retries.
 */
export async function processReel(reelId: string): Promise<void> {
  const reel = await reelRepo.findReelByIdUnscoped(reelId);
  if (!reel) {
    throw new Error(`Reel ${reelId} not found.`);
  }

  if (reel.status === "DONE") {
    return;
  }

  try {
    await reelRepo.updateReelStatus(reelId, "EXTRACTING", null);

    const extracted = await extractReelContent(reel.sourceUrl);
    await reelRepo.updateReelExtraction(reelId, extracted);

    await reelRepo.updateReelStatus(reelId, "SUMMARIZING", null);

    const aiResult = await summarizeReelCaption(extracted.caption, extracted.authorHandle);
    const category = await categoryRepo.findOrCreateCategory(reel.userId, aiResult.category);

    await reelRepo.updateReelSummary(reelId, {
      summary: aiResult.summary,
      keyPoints: aiResult.keyPoints,
      categoryId: category.id,
      processedAt: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown processing error.";
    await reelRepo.markReelFailed(reelId, message);
    throw err;
  }
}
