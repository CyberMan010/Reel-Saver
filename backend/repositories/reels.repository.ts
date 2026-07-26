import { supabaseAdmin } from "../config/supabase";
import type { Reel, ReelStatus } from "../types/reel.types";

const TABLE = "Reel";

export async function createReel(payload: {
  id: string;
  userId: string;
  sourceUrl: string;
}): Promise<Reel> {
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .insert([
      {
        id: payload.id,
        userId: payload.userId,
        sourceUrl: payload.sourceUrl,
        status: "PENDING",
        keyPoints: [],
      },
    ])
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return data as Reel;
}

export async function findReelById(
  id: string,
  userId: string
): Promise<Reel | null> {
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select("*")
    .eq("id", id)
    .eq("userId", userId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data as Reel | null;
}

/**
 * Internal worker lookup — no userId scoping. Never expose via HTTP routes.
 */
export async function findReelByIdUnscoped(id: string): Promise<Reel | null> {
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data as Reel | null;
}

export async function listReelsByUser(
  userId: string,
  filters?: { status?: ReelStatus; categoryId?: string }
): Promise<Reel[]> {
  let query = supabaseAdmin.from(TABLE).select("*").eq("userId", userId);

  if (filters?.status) {
    query = query.eq("status", filters.status);
  }
  if (filters?.categoryId) {
    query = query.eq("categoryId", filters.categoryId);
  }

  const { data, error } = await query.order("createdAt", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as Reel[];
}

export async function updateReelStatus(
  id: string,
  status: ReelStatus,
  errorMessage?: string | null
): Promise<void> {
  const updates: Record<string, unknown> = { status };
  if (errorMessage !== undefined) {
    updates.errorMessage = errorMessage;
  }

  const { error } = await supabaseAdmin.from(TABLE).update(updates).eq("id", id);

  if (error) throw new Error(error.message);
}

export async function updateReelExtraction(
  id: string,
  fields: {
    authorHandle?: string | null;
    caption?: string | null;
    thumbnailUrl?: string | null;
    transcript?: string | null;
  }
): Promise<void> {
  const { error } = await supabaseAdmin.from(TABLE).update(fields).eq("id", id);

  if (error) throw new Error(error.message);
}

export async function updateReelSummary(
  id: string,
  fields: {
    summary: string;
    keyPoints: string[];
    categoryId: string;
    processedAt: string;
  }
): Promise<void> {
  const { error } = await supabaseAdmin
    .from(TABLE)
    .update({
      ...fields,
      status: "DONE",
      errorMessage: null,
    })
    .eq("id", id);

  if (error) throw new Error(error.message);
}

export async function markReelFailed(
  id: string,
  errorMessage: string
): Promise<void> {
  const { error } = await supabaseAdmin
    .from(TABLE)
    .update({ status: "FAILED", errorMessage })
    .eq("id", id);

  if (error) throw new Error(error.message);
}
