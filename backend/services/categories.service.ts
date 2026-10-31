import * as categoryRepo from "../repositories/categories.repository";
import * as reelRepo from "../repositories/reels.repository";
import { REEL_CATEGORIES } from "./ai.service";
import type { Category, CategoryWithCount } from "../types/reel.types";

export async function listCategoriesForUser(
  userId: string
): Promise<{ categories: CategoryWithCount[]; suggestedDefaults: readonly string[] }> {
  const [categories, reels] = await Promise.all([
    categoryRepo.listCategoriesByUser(userId),
    reelRepo.listReelsByUser(userId),
  ]);

  const counts = new Map<string, number>();
  for (const reel of reels) {
    if (reel.categoryId) {
      counts.set(reel.categoryId, (counts.get(reel.categoryId) ?? 0) + 1);
    }
  }

  const withCounts: CategoryWithCount[] = categories.map((cat) => ({
    ...cat,
    reelCount: counts.get(cat.id) ?? 0,
  }));

  return {
    categories: withCounts,
    suggestedDefaults: REEL_CATEGORIES,
  };
}

export async function createCategoryForUser(
  userId: string,
  name: string
): Promise<Category> {
  const trimmed = name.trim();
  if (!trimmed) {
    throw Object.assign(new Error("Category name is required."), {
      statusCode: 422,
    });
  }
  return categoryRepo.findOrCreateCategory(userId, trimmed);
}

export async function renameCategoryForUser(
  userId: string,
  categoryId: string,
  newName: string
): Promise<Category> {
  const trimmed = newName.trim();
  if (!trimmed) {
    throw Object.assign(new Error("New category name is required."), {
      statusCode: 422,
    });
  }
  return categoryRepo.renameCategory(categoryId, userId, trimmed);
}

export async function deleteCategoryForUser(
  userId: string,
  categoryId: string
): Promise<void> {
  await categoryRepo.deleteCategory(categoryId, userId);
}
