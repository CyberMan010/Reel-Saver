import { randomUUID } from "crypto";
import { isSupabaseConfigured } from "../config/env";
import { supabaseAdmin } from "../config/supabase";
import { mutateLocalDb, readLocalDb } from "../storage/localStore";
import type { Category } from "../types/reel.types";

const TABLE = "Category";
const REEL_TABLE = "Reel";

export async function findCategoryById(
  id: string,
  userId: string
): Promise<Category | null> {
  if (!isSupabaseConfigured()) {
    const db = readLocalDb();
    return (
      db.categories.find((c) => c.id === id && c.userId === userId) ?? null
    );
  }

  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select("*")
    .eq("id", id)
    .eq("userId", userId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data as Category | null;
}

export async function findCategoryByUserAndName(
  userId: string,
  name: string
): Promise<Category | null> {
  const normalized = name.trim().toLowerCase();

  if (!isSupabaseConfigured()) {
    const db = readLocalDb();
    return (
      db.categories.find(
        (c) => c.userId === userId && c.name.trim().toLowerCase() === normalized
      ) ?? null
    );
  }

  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select("*")
    .eq("userId", userId);

  if (error) throw new Error(error.message);
  const categories = (data ?? []) as Category[];
  return (
    categories.find((c) => c.name.trim().toLowerCase() === normalized) ?? null
  );
}

export async function createCategory(
  userId: string,
  name: string
): Promise<Category> {
  const trimmedName = name.trim();
  const id = randomUUID();

  if (!isSupabaseConfigured()) {
    const category: Category = {
      id,
      name: trimmedName,
      userId,
      createdAt: new Date().toISOString(),
    };
    return mutateLocalDb((db) => {
      db.categories.push(category);
      return category;
    });
  }

  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .insert([{ id, name: trimmedName, userId }])
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return data as Category;
}

export async function findOrCreateCategory(
  userId: string,
  name: string
): Promise<Category> {
  const trimmed = name.trim();
  const existing = await findCategoryByUserAndName(userId, trimmed);
  if (existing) return existing;
  return createCategory(userId, trimmed);
}

export async function listCategoriesByUser(
  userId: string
): Promise<Category[]> {
  if (!isSupabaseConfigured()) {
    const db = readLocalDb();
    return db.categories
      .filter((c) => c.userId === userId)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select("*")
    .eq("userId", userId)
    .order("name", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as Category[];
}

/**
 * Rename an existing category for a user.
 * If another category for the same user already has `newName`, merges all reels
 * from this category into that existing category and removes the duplicate.
 */
export async function renameCategory(
  id: string,
  userId: string,
  newName: string
): Promise<Category> {
  const trimmed = newName.trim();
  const current = await findCategoryById(id, userId);
  if (!current) {
    throw Object.assign(new Error("Category not found."), { statusCode: 404 });
  }

  const duplicate = await findCategoryByUserAndName(userId, trimmed);

  if (duplicate && duplicate.id !== current.id) {
    // Merge reels into duplicate category and remove old category
    if (!isSupabaseConfigured()) {
      return mutateLocalDb((db) => {
        for (const reel of db.reels) {
          if (reel.userId === userId && reel.categoryId === current.id) {
            reel.categoryId = duplicate.id;
          }
        }
        db.categories = db.categories.filter((c) => c.id !== current.id);
        return duplicate;
      });
    }

    const { error: moveErr } = await supabaseAdmin
      .from(REEL_TABLE)
      .update({ categoryId: duplicate.id })
      .eq("userId", userId)
      .eq("categoryId", current.id);
    if (moveErr) throw new Error(moveErr.message);

    const { error: delErr } = await supabaseAdmin
      .from(TABLE)
      .delete()
      .eq("id", current.id)
      .eq("userId", userId);
    if (delErr) throw new Error(delErr.message);

    return duplicate;
  }

  if (!isSupabaseConfigured()) {
    return mutateLocalDb((db) => {
      const cat = db.categories.find(
        (c) => c.id === current.id && c.userId === userId
      );
      if (!cat) {
        throw Object.assign(new Error("Category not found."), {
          statusCode: 404,
        });
      }
      cat.name = trimmed;
      return { ...cat };
    });
  }

  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .update({ name: trimmed })
    .eq("id", current.id)
    .eq("userId", userId)
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return data as Category;
}

/**
 * Delete a category and unassign any reels that belonged to it.
 */
export async function deleteCategory(
  id: string,
  userId: string
): Promise<void> {
  const current = await findCategoryById(id, userId);
  if (!current) {
    throw Object.assign(new Error("Category not found."), { statusCode: 404 });
  }

  if (!isSupabaseConfigured()) {
    mutateLocalDb((db) => {
      for (const reel of db.reels) {
        if (reel.userId === userId && reel.categoryId === id) {
          reel.categoryId = null;
        }
      }
      db.categories = db.categories.filter(
        (c) => !(c.id === id && c.userId === userId)
      );
    });
    return;
  }

  const { error: unlinkErr } = await supabaseAdmin
    .from(REEL_TABLE)
    .update({ categoryId: null })
    .eq("userId", userId)
    .eq("categoryId", id);
  if (unlinkErr) throw new Error(unlinkErr.message);

  const { error: delErr } = await supabaseAdmin
    .from(TABLE)
    .delete()
    .eq("id", id)
    .eq("userId", userId);
  if (delErr) throw new Error(delErr.message);
}
