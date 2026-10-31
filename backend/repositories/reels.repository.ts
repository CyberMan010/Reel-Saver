import { supabaseAdmin } from "../config/supabase";
import { mutateLocalDb, readLocalDb } from "../storage/localStore";
import { withStorageFallback } from "../storage/storageManager";
import type { Reel, ReelStatus } from "../types/reel.types";

const TABLE = "Reel";

const EXTENDED_COLUMNS = new Set([
  "title",
  "notes",
  "audioUrl",
  "audioDurationSec",
  "transcriptionSource",
]);

function normalizeReelRow(row: Partial<Reel> & Record<string, unknown>): Reel {
  return {
    id: String(row.id),
    userId: String(row.userId),
    sourceUrl: String(row.sourceUrl ?? ""),
    title: (row.title as string | null) ?? null,
    authorHandle: (row.authorHandle as string | null) ?? null,
    caption: (row.caption as string | null) ?? null,
    thumbnailUrl: (row.thumbnailUrl as string | null) ?? null,
    transcript: (row.transcript as string | null) ?? null,
    summary: (row.summary as string | null) ?? null,
    keyPoints: Array.isArray(row.keyPoints) ? (row.keyPoints as string[]) : [],
    notes: (row.notes as string | null) ?? null,
    audioUrl: (row.audioUrl as string | null) ?? null,
    audioDurationSec:
      typeof row.audioDurationSec === "number" ? row.audioDurationSec : null,
    transcriptionSource: (row.transcriptionSource as string | null) ?? null,
    status: (row.status as ReelStatus) ?? "PENDING",
    errorMessage: (row.errorMessage as string | null) ?? null,
    categoryId: (row.categoryId as string | null) ?? null,
    createdAt: String(row.createdAt ?? new Date().toISOString()),
    processedAt: (row.processedAt as string | null) ?? null,
  };
}

function stripExtendedColumns(
  payload: Record<string, unknown>
): Record<string, unknown> {
  const copy: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(payload)) {
    if (!EXTENDED_COLUMNS.has(key)) {
      copy[key] = val;
    }
  }
  return copy;
}

function isMissingColumnOrEnumError(message: string): boolean {
  return /column .* does not exist|Could not find the '.*' column|invalid input value for enum/i.test(
    message
  );
}

export async function createReel(payload: {
  id: string;
  userId: string;
  sourceUrl: string;
  title?: string | null;
  authorHandle?: string | null;
  caption?: string | null;
  thumbnailUrl?: string | null;
  transcript?: string | null;
  notes?: string | null;
  audioUrl?: string | null;
  audioDurationSec?: number | null;
  transcriptionSource?: string | null;
  categoryId?: string | null;
}): Promise<Reel> {
  const now = new Date().toISOString();
  const fullRecord: Reel = {
    id: payload.id,
    userId: payload.userId,
    sourceUrl: payload.sourceUrl,
    title: payload.title ?? null,
    authorHandle: payload.authorHandle ?? null,
    caption: payload.caption ?? null,
    thumbnailUrl: payload.thumbnailUrl ?? null,
    transcript: payload.transcript ?? null,
    summary: null,
    keyPoints: [],
    notes: payload.notes ?? null,
    audioUrl: payload.audioUrl ?? null,
    audioDurationSec: payload.audioDurationSec ?? null,
    transcriptionSource: payload.transcriptionSource ?? null,
    status: "PENDING",
    errorMessage: null,
    categoryId: payload.categoryId ?? null,
    createdAt: now,
    processedAt: null,
  };

  return withStorageFallback(
    async () => {
      const insertPayload: Record<string, unknown> = {
        id: fullRecord.id,
        userId: fullRecord.userId,
        sourceUrl: fullRecord.sourceUrl,
        title: fullRecord.title,
        authorHandle: fullRecord.authorHandle,
        caption: fullRecord.caption,
        thumbnailUrl: fullRecord.thumbnailUrl,
        transcript: fullRecord.transcript,
        notes: fullRecord.notes,
        audioUrl: fullRecord.audioUrl,
        audioDurationSec: fullRecord.audioDurationSec,
        transcriptionSource: fullRecord.transcriptionSource,
        categoryId: fullRecord.categoryId,
        status: "PENDING",
        keyPoints: [],
      };

      const { data, error } = await supabaseAdmin
        .from(TABLE)
        .insert([insertPayload])
        .select("*")
        .single();

      if (error) {
        if (isMissingColumnOrEnumError(error.message)) {
          const fallback = stripExtendedColumns(insertPayload);
          const retry = await supabaseAdmin
            .from(TABLE)
            .insert([fallback])
            .select("*")
            .single();
          if (retry.error) throw new Error(retry.error.message);
          return normalizeReelRow(retry.data as Record<string, unknown>);
        }
        throw new Error(error.message);
      }

      return normalizeReelRow(data as Record<string, unknown>);
    },
    () =>
      mutateLocalDb((db) => {
        db.reels.push(fullRecord);
        return { ...fullRecord };
      })
  );
}

export async function findReelById(
  id: string,
  userId: string
): Promise<Reel | null> {
  return withStorageFallback(
    async () => {
      const { data, error } = await supabaseAdmin
        .from(TABLE)
        .select("*")
        .eq("id", id)
        .eq("userId", userId)
        .maybeSingle();

      if (error) throw new Error(error.message);
      return data ? normalizeReelRow(data as Record<string, unknown>) : null;
    },
    () => {
      const db = readLocalDb();
      const found = db.reels.find((r) => r.id === id && r.userId === userId);
      return found ? { ...found, keyPoints: [...found.keyPoints] } : null;
    }
  );
}

export async function findReelByIdUnscoped(id: string): Promise<Reel | null> {
  return withStorageFallback(
    async () => {
      const { data, error } = await supabaseAdmin
        .from(TABLE)
        .select("*")
        .eq("id", id)
        .maybeSingle();

      if (error) throw new Error(error.message);
      return data ? normalizeReelRow(data as Record<string, unknown>) : null;
    },
    () => {
      const db = readLocalDb();
      const found = db.reels.find((r) => r.id === id);
      return found ? { ...found, keyPoints: [...found.keyPoints] } : null;
    }
  );
}

export async function listReelsByUser(
  userId: string,
  filters?: { status?: ReelStatus; categoryId?: string; search?: string }
): Promise<Reel[]> {
  let rows = await withStorageFallback(
    async () => {
      let query = supabaseAdmin.from(TABLE).select("*").eq("userId", userId);

      if (filters?.status) {
        query = query.eq("status", filters.status);
      }
      if (filters?.categoryId) {
        query = query.eq("categoryId", filters.categoryId);
      }

      const { data, error } = await query.order("createdAt", {
        ascending: false,
      });
      if (error) throw new Error(error.message);
      return ((data ?? []) as Record<string, unknown>[]).map(normalizeReelRow);
    },
    () => {
      const db = readLocalDb();
      return db.reels
        .filter((r) => r.userId === userId)
        .filter((r) => (!filters?.status ? true : r.status === filters.status))
        .filter((r) =>
          !filters?.categoryId ? true : r.categoryId === filters.categoryId
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map((r) => ({ ...r, keyPoints: [...r.keyPoints] }));
    }
  );

  if (filters?.search && filters.search.trim()) {
    const q = filters.search.trim().toLowerCase();
    rows = rows.filter((r) => {
      const haystack = [
        r.title,
        r.summary,
        r.transcript,
        r.caption,
        r.authorHandle,
        r.notes,
        r.sourceUrl,
        ...(r.keyPoints ?? []),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }

  return rows;
}

async function applySupabaseReelUpdate(
  id: string,
  updates: Record<string, unknown>
): Promise<Reel> {
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .update(updates)
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    if (isMissingColumnOrEnumError(error.message)) {
      const safeUpdates = stripExtendedColumns(updates);
      if (safeUpdates.status === "TRANSCRIBING") {
        safeUpdates.status = "EXTRACTING";
      }
      const retry = await supabaseAdmin
        .from(TABLE)
        .update(safeUpdates)
        .eq("id", id)
        .select("*")
        .single();
      if (retry.error) throw new Error(retry.error.message);
      return normalizeReelRow(retry.data as Record<string, unknown>);
    }
    throw new Error(error.message);
  }

  return normalizeReelRow(data as Record<string, unknown>);
}

export async function updateReelStatus(
  id: string,
  status: ReelStatus,
  errorMessage?: string | null
): Promise<void> {
  await withStorageFallback(
    async () => {
      const updates: Record<string, unknown> = { status };
      if (errorMessage !== undefined) {
        updates.errorMessage = errorMessage;
      }
      await applySupabaseReelUpdate(id, updates);
    },
    () => {
      mutateLocalDb((db) => {
        const reel = db.reels.find((r) => r.id === id);
        if (reel) {
          reel.status = status;
          if (errorMessage !== undefined) {
            reel.errorMessage = errorMessage;
          }
        }
      });
    }
  );
}

export async function updateReelExtraction(
  id: string,
  fields: {
    title?: string | null;
    authorHandle?: string | null;
    caption?: string | null;
    thumbnailUrl?: string | null;
    transcript?: string | null;
    audioUrl?: string | null;
    audioDurationSec?: number | null;
    transcriptionSource?: string | null;
  }
): Promise<void> {
  await withStorageFallback(
    async () => {
      await applySupabaseReelUpdate(id, fields as Record<string, unknown>);
    },
    () => {
      mutateLocalDb((db) => {
        const reel = db.reels.find((r) => r.id === id);
        if (!reel) return;
        if (fields.title !== undefined) reel.title = fields.title;
        if (fields.authorHandle !== undefined)
          reel.authorHandle = fields.authorHandle;
        if (fields.caption !== undefined) reel.caption = fields.caption;
        if (fields.thumbnailUrl !== undefined)
          reel.thumbnailUrl = fields.thumbnailUrl;
        if (fields.transcript !== undefined)
          reel.transcript = fields.transcript;
        if (fields.audioUrl !== undefined) reel.audioUrl = fields.audioUrl;
        if (fields.audioDurationSec !== undefined)
          reel.audioDurationSec = fields.audioDurationSec;
        if (fields.transcriptionSource !== undefined)
          reel.transcriptionSource = fields.transcriptionSource;
      });
    }
  );
}

export async function updateReelSummary(
  id: string,
  fields: {
    title?: string | null;
    summary: string;
    keyPoints: string[];
    categoryId: string | null;
    processedAt: string;
  }
): Promise<void> {
  await withStorageFallback(
    async () => {
      await applySupabaseReelUpdate(id, {
        ...fields,
        status: "DONE",
        errorMessage: null,
      });
    },
    () => {
      mutateLocalDb((db) => {
        const reel = db.reels.find((r) => r.id === id);
        if (!reel) return;
        if (fields.title !== undefined && !reel.title) {
          reel.title = fields.title;
        }
        reel.summary = fields.summary;
        reel.keyPoints = [...fields.keyPoints];
        reel.categoryId = fields.categoryId;
        reel.processedAt = fields.processedAt;
        reel.status = "DONE";
        reel.errorMessage = null;
      });
    }
  );
}

export async function updateReelFields(
  id: string,
  fields: Partial<
    Pick<
      Reel,
      | "title"
      | "authorHandle"
      | "caption"
      | "thumbnailUrl"
      | "transcript"
      | "summary"
      | "keyPoints"
      | "notes"
      | "categoryId"
      | "status"
      | "errorMessage"
      | "processedAt"
    >
  >
): Promise<Reel> {
  return withStorageFallback(
    async () => applySupabaseReelUpdate(id, fields as Record<string, unknown>),
    () =>
      mutateLocalDb((db) => {
        const reel = db.reels.find((r) => r.id === id);
        if (!reel) {
          throw Object.assign(new Error("Reel not found."), {
            statusCode: 404,
          });
        }
        Object.assign(reel, fields);
        if (fields.keyPoints) {
          reel.keyPoints = [...fields.keyPoints];
        }
        return { ...reel, keyPoints: [...reel.keyPoints] };
      })
  );
}

export async function markReelFailed(
  id: string,
  errorMessage: string
): Promise<void> {
  await withStorageFallback(
    async () => {
      await applySupabaseReelUpdate(id, { status: "FAILED", errorMessage });
    },
    () => {
      mutateLocalDb((db) => {
        const reel = db.reels.find((r) => r.id === id);
        if (reel) {
          reel.status = "FAILED";
          reel.errorMessage = errorMessage;
        }
      });
    }
  );
}

export async function updateReelCategory(
  id: string,
  categoryId: string | null
): Promise<Reel> {
  return updateReelFields(id, { categoryId });
}

export async function deleteReel(id: string, userId: string): Promise<void> {
  await withStorageFallback(
    async () => {
      const { error } = await supabaseAdmin
        .from(TABLE)
        .delete()
        .eq("id", id)
        .eq("userId", userId);

      if (error) throw new Error(error.message);
    },
    () => {
      mutateLocalDb((db) => {
        db.reels = db.reels.filter(
          (r) => !(r.id === id && r.userId === userId)
        );
      });
    }
  );
}
