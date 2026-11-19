import path from "path";
import { ENV, hasSupabaseEnvCredentials } from "../config/env";
import { supabaseAdmin } from "../config/supabase";

type HealthState = "unknown" | "healthy" | "fallback-local";

let supabaseState: HealthState = "unknown";
let lastCheckedAt = 0;
let lastFallbackReason: string | null = null;
let inflightProbe: Promise<boolean> | null = null;

// Once selected, keep the same store for the lifetime of this process.
// Automatically switching stores would make accounts and reels disappear.


export function isSupabaseConnectivityOrSetupError(message: string): boolean {
  return /fetch failed|abort|timed? ?out|ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN|UND_ERR|network|Invalid API key|JWT|Project is paused|502|503|504|Could not find the table|relation .* does not exist/i.test(
    message
  );
}

function recordFallback(reason: string): void {
  const changed = supabaseState !== "fallback-local";
  supabaseState = "fallback-local";
  lastCheckedAt = Date.now();
  lastFallbackReason = reason;

  if (changed && ENV.NODE_ENV !== "test") {
    const localFile = path.join(ENV.LOCAL_DATA_DIR, "local-db.json");
    console.warn(
      `\n[Storage] Supabase unavailable (${reason}).\n` +
        `[Storage] Automatically switched to local persistent database: ${localFile}\n` +
        `[Storage] (Tip: unpause your project in https://supabase.com/dashboard or set STORAGE_MODE=local in .env to silence this check.)\n`
    );
  }
}

export async function probeSupabaseHealth(): Promise<boolean> {
  if (ENV.STORAGE_MODE === "local" || !hasSupabaseEnvCredentials()) {
    supabaseState = "fallback-local";
    lastFallbackReason =
      ENV.STORAGE_MODE === "local"
        ? "STORAGE_MODE=local"
        : "SUPABASE_URL / SUPABASE_SECRET_KEY not set";
    return false;
  }

  if (supabaseState === "healthy") {
    return true;
  }

  if (
    supabaseState === "fallback-local" &&
    ENV.STORAGE_MODE === "auto" &&
    lastCheckedAt > 0
  ) {
    return false;
  }

  if (inflightProbe) {
    return inflightProbe;
  }

  inflightProbe = (async () => {
    try {
      const { error } = await supabaseAdmin
        .from("users")
        .select("id")
        .limit(1);

      if (error) {
        if (ENV.STORAGE_MODE === "supabase") {
          return true; // Let explicit supabase mode surface exact error on query
        }
        recordFallback(error.message);
        return false;
      }

      supabaseState = "healthy";
      lastCheckedAt = Date.now();
      lastFallbackReason = null;
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (ENV.STORAGE_MODE === "supabase") {
        return true;
      }
      recordFallback(msg);
      return false;
    } finally {
      inflightProbe = null;
    }
  })();

  return inflightProbe;
}

export function getStorageStatusSummary(): {
  activeBackend: "supabase" | "local-json";
  configuredMode: string;
  supabaseConfigured: boolean;
  fallbackReason: string | null;
} {
  const configured = hasSupabaseEnvCredentials();
  const activeBackend =
    configured && supabaseState === "healthy" ? "supabase" : "local-json";

  return {
    activeBackend,
    configuredMode: ENV.STORAGE_MODE,
    supabaseConfigured: configured,
    fallbackReason: activeBackend === "local-json" ? lastFallbackReason : null,
  };
}

/**
 * Executes `supabaseFn` when Supabase is configured & reachable.
 * Auto mode selects a store on the initial health probe and keeps it for the
 * process lifetime. If the selected Supabase store fails later, fail closed
 * rather than creating accounts or other records in a different database.
 */
export async function withStorageFallback<T>(
  supabaseFn: () => Promise<T>,
  localFn: () => T | Promise<T>
): Promise<T> {
  if (ENV.STORAGE_MODE === "local") return await localFn();
  if (!hasSupabaseEnvCredentials()) {
    if (ENV.STORAGE_MODE === "supabase") {
      throw Object.assign(new Error("Supabase is not configured. Check SUPABASE_URL and the service role key."), { statusCode: 503 });
    }
    return await localFn();
  }

  const useSupabase = await probeSupabaseHealth();
  if (!useSupabase && ENV.STORAGE_MODE === "auto") {
    return await localFn();
  }

  try {
    return await supabaseFn();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);

    if (
      ENV.STORAGE_MODE === "auto" &&
      isSupabaseConnectivityOrSetupError(msg)
    ) {
      // A request may already have written data to Supabase. Never redirect a
      // failed operation to a separate database after selecting Supabase.
      throw Object.assign(new Error("Storage is temporarily unavailable. Please try again; no switch to a different account database was made."), { statusCode: 503 });
    }

    if (isSupabaseConnectivityOrSetupError(msg)) {
      throw Object.assign(
        new Error(
          `Cannot reach Supabase (${ENV.SUPABASE_URL}): ${msg}. Check if your Supabase project is paused in the Supabase Dashboard, run 00000000000000_init_full_schema.sql, or set STORAGE_MODE=auto in .env.`
        ),
        { statusCode: 503 }
      );
    }

    throw err;
  }
}
