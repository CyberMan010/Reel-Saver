import type { Request, Response, NextFunction } from "express";
import * as categoriesService from "../services/categories.service";
import { sendSuccess } from "../utils/response.util";

export async function listCategories(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await categoriesService.listCategoriesForUser(
      req.user!.userId
    );
    sendSuccess(res, "Categories retrieved successfully.", result);
  } catch (err) {
    next(err);
  }
}

export async function createCategory(
  req: Request<object, object, { name: string }>,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const category = await categoriesService.createCategoryForUser(
      req.user!.userId,
      req.body.name
    );
    sendSuccess(res, "Category created successfully.", { category }, 201);
  } catch (err) {
    next(err);
  }
}

export async function renameCategory(
  req: Request<{ id: string }, object, { name: string }>,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const category = await categoriesService.renameCategoryForUser(
      req.user!.userId,
      req.params.id,
      req.body.name
    );
    sendSuccess(res, "Category renamed successfully.", { category });
  } catch (err) {
    next(err);
  }
}

export async function deleteCategory(
  req: Request<{ id: string }>,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    await categoriesService.deleteCategoryForUser(
      req.user!.userId,
      req.params.id
    );
    sendSuccess(res, "Category deleted successfully.");
  } catch (err) {
    next(err);
  }
}
