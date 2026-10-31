import { randomUUID } from "crypto";
import { supabaseAdmin } from "../config/supabase";
import { mutateLocalDb, readLocalDb } from "../storage/localStore";
import { withStorageFallback } from "../storage/storageManager";
import type { Category } from "../types/reel.types";

const TABLE = "Category";
const REEL_TABLE = "Reel";

export async function findCategoryById(
  id: string,
  userId: string
): Promise<Category | null> {
  return withStorageFallback(
    async () => {
      const { data, error } = await supabaseAdmin
        .from(TABLE)
        .select("*")
        .eq("id", id)
        .eq("userId", userId)
        .maybeSingle();

      if (error) throw new Error(error.message);
      return data as Category | null;
    },
    () => {
      const db = readLocalDb();
      return (
        db.categories.find((c) => c.id === id && c.userId === userId) ?? null
      );
    }
  );
}

export async function findCategoryByUserAndName(
  userId: string,
  name: string
): Promise<Category | null> {
  const normalized = name.trim().toLowerCase();

  return withStorageFallback(
    async () => {
      const { data, error } = await supabaseAdmin
        .from(TABLE)
        .select("*")
        .eq("userId", userId);

      if (error) throw new Error(error.message);
      const categories = (data ?? []) as Category[];
      return (
        categories.find((c) => c.name.trim().toLowerCase() === normalized) ??
        null
      );
    },
    () => {
      const db = readLocalDb();
      return (
        db.categories.find(
          (c) =>
            c.userId === userId && c.name.trim().toLowerCase() === normalized
        ) ?? null
      );
    }
  );
}

export async function createCategory(
  userId: string,
  name: string
): Promise<Category> {
  const trimmedName = name.trim();
  const id = randomUUID();

  return withStorageFallback(
    async () => {
      const { data, error } = await supabaseAdmin
        .from(TABLE)
        .insert([{ id, name: trimmedName, userId }])
        .select("*")
        .single();

      if (error) throw new Error(error.message);
      return data as Category;
    },
    () => {
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
  );
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
  return withStorageFallback(
    async () => {
      const { data, error } = await supabaseAdmin
        .from(TABLE)
        .select("*")
        .eq("userId", userId)
        .order("name", { ascending: true });

      if (error) throw new Error(error.message);
      return (data ?? []) as Category[];
    },
    () => {
      const db = readLocalDb();
      return db.categories
        .filter((c) => c.userId === userId)
        .sort((a, b) => a.name.localeCompare(b.name));
    }
  );
}

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
    return withStorageFallback(
      async () => {
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
      },
      () =>
        mutateLocalDb((db) => {
          for (const reel of db.reels) {
            if (reel.userId === userId && reel.categoryId === current.id) {
              reel.categoryId = duplicate.id;
            }
          }
          db.categories = db.categories.filter((c) => c.id !== current.id);
          return duplicate;
        })
    );
  }

  return withStorageFallback(
    async () => {
      const { data, error } = await supabaseAdmin
        .from(TABLE)
        .update({ name: trimmed })
        .eq("id", current.id)
        .eq("userId", userId)
        .select("*")
        .single();

      if (error) throw new Error(error.message);
      return data as Category;
    },
    () =>
      mutateLocalDb((db) => {
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
      })
  );
}

export async function deleteCategory(
  id: string,
  userId: string
): Promise<void> {
  const current = await findCategoryById(id, userId);
  if (!current) {
    throw Object.assign(new Error("Category not found."), { statusCode: 404 });
  }

  await withStorageFallback(
    async () => {
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
    },
    () => {
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
    }
  );
}
