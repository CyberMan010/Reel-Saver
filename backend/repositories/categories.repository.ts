import { supabaseAdmin } from "../config/supabase";
import type { Category } from "../types/reel.types";

const TABLE = "Category";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function categoryIdFor(userId: string, name: string): string {
  return `${userId}-${slugify(name)}`;
}

export async function findCategoryByUserAndName(
  userId: string,
  name: string
): Promise<Category | null> {
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select("*")
    .eq("userId", userId)
    .eq("name", name)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data as Category | null;
}

export async function createCategory(
  userId: string,
  name: string
): Promise<Category> {
  const id = categoryIdFor(userId, name);

  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .insert([{ id, name, userId }])
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return data as Category;
}

/**
 * Find an existing category for this user or create it.
 */
export async function findOrCreateCategory(
  userId: string,
  name: string
): Promise<Category> {
  const existing = await findCategoryByUserAndName(userId, name);
  if (existing) return existing;
  return createCategory(userId, name);
}

export async function listCategoriesByUser(userId: string): Promise<Category[]> {
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select("*")
    .eq("userId", userId)
    .order("name", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as Category[];
}
