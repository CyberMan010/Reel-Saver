import type { Request, Response, NextFunction } from "express";
import * as reelsService from "../services/reels.service";
import { sendSuccess } from "../utils/response.util";
import type {
  ConfirmConvertBody,
  CreateReelBody,
  ListReelsQuery,
  ReelStatus,
  UpdateReelBody,
} from "../types/reel.types";

export async function createReel(
  req: Request<object, object, CreateReelBody>,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const uploadedFile = req.file
      ? {
          path: req.file.path,
          originalname: req.file.originalname,
          mimetype: req.file.mimetype,
        }
      : null;

    const reel = await reelsService.saveReel(
      req.user!.userId,
      req.body ?? {},
      uploadedFile
    );
    const message =
      reel.status === "AWAITING_CONFIRMATION"
        ? "Reel saved. Waiting for your confirmation to convert & transcribe."
        : "Reel saved. Processing started.";
    sendSuccess(res, message, { reel }, 202);
  } catch (err) {
    next(err);
  }
}

export async function listReels(
  req: Request<object, object, object, ListReelsQuery>,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const query: ListReelsQuery = {
      status: req.query.status as ReelStatus | undefined,
      categoryId: req.query.categoryId,
      search: req.query.search,
    };
    const reels = await reelsService.listReelsForUser(req.user!.userId, query);
    sendSuccess(res, "Reels retrieved successfully.", {
      reels,
      total: reels.length,
    });
  } catch (err) {
    next(err);
  }
}

export async function getReel(
  req: Request<{ id: string }>,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const reel = await reelsService.getReelForUser(
      req.user!.userId,
      req.params.id
    );
    sendSuccess(res, "Reel retrieved successfully.", { reel });
  } catch (err) {
    next(err);
  }
}

export async function updateReel(
  req: Request<{ id: string }, object, UpdateReelBody>,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const reel = await reelsService.updateReelForUser(
      req.user!.userId,
      req.params.id,
      req.body
    );
    sendSuccess(res, "Reel updated successfully.", { reel });
  } catch (err) {
    next(err);
  }
}

export async function updateCategory(
  req: Request<{ id: string }, object, { categoryName: string }>,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const reel = await reelsService.updateReelCategory(
      req.user!.userId,
      req.params.id,
      req.body.categoryName
    );
    sendSuccess(res, "Category updated.", { reel });
  } catch (err) {
    next(err);
  }
}

export async function uploadReelMedia(
  req: Request<{ id: string }>,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.file) {
      throw Object.assign(
        new Error("Please attach a video (MP4) or audio (MP3) file."),
        { statusCode: 422 }
      );
    }

    const reel = await reelsService.attachMediaToReel(
      req.user!.userId,
      req.params.id,
      {
        path: req.file.path,
        originalname: req.file.originalname,
        mimetype: req.file.mimetype,
      }
    );

    sendSuccess(
      res,
      "Media uploaded. Converting to MP3, transcribing, and summarizing.",
      { reel },
      202
    );
  } catch (err) {
    next(err);
  }
}

export async function resummarizeReel(
  req: Request<{ id: string }>,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const reel = await reelsService.resummarizeReelForUser(
      req.user!.userId,
      req.params.id
    );
    sendSuccess(res, "Summary regenerated successfully.", { reel });
  } catch (err) {
    next(err);
  }
}

export async function confirmConvertReel(
  req: Request<{ id: string }, object, ConfirmConvertBody>,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const mediaFormat = req.body?.mediaFormat ?? "mp3";
    const reel = await reelsService.confirmAndConvertReelForUser(
      req.user!.userId,
      req.params.id,
      mediaFormat
    );
    sendSuccess(
      res,
      mediaFormat === "skip"
        ? "Extracting caption & summarizing without audio download."
        : `Auto-converting Reel to ${mediaFormat.toUpperCase()} and transcribing voice to text.`,
      { reel },
      202
    );
  } catch (err) {
    next(err);
  }
}

export async function retryReel(
  req: Request<{ id: string }, object, ConfirmConvertBody>,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const reel = await reelsService.retryReelForUser(
      req.user!.userId,
      req.params.id,
      req.body?.mediaFormat ?? "mp3"
    );
    sendSuccess(res, "Reel processing restarted.", { reel }, 202);
  } catch (err) {
    next(err);
  }
}

export async function deleteReel(
  req: Request<{ id: string }>,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    await reelsService.deleteReelForUser(req.user!.userId, req.params.id);
    sendSuccess(res, "Reel deleted successfully.");
  } catch (err) {
    next(err);
  }
}
