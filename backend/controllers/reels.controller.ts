import type { Request, Response, NextFunction } from "express";
import * as reelsService from "../services/reels.service";
import { sendSuccess } from "../utils/response.util";
import type { CreateReelBody, ListReelsQuery, ReelStatus } from "../types/reel.types";


export async function createReel(
  req: Request<object, object, CreateReelBody>,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const reel = await reelsService.saveReel(req.user!.userId, req.body);
    sendSuccess(res, "Reel saved. Processing started.", { reel }, 202);
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
    };
    const reels = await reelsService.listReelsForUser(req.user!.userId, query);
    sendSuccess(res, "Reels retrieved successfully.", { reels, total: reels.length });
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
    const reel = await reelsService.getReelForUser(req.user!.userId, req.params.id);
    sendSuccess(res, "Reel retrieved successfully.", { reel });
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
    const reel = await reelsService.updateReelCategory(req.user!.userId, req.params.id, req.body.categoryName);
    sendSuccess(res, "Category updated.", { reel });
  } catch (err) {
    next(err);
  }
}