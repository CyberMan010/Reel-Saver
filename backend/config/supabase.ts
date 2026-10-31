import { createClient } from "@supabase/supabase-js";
import { ENV } from "./env";

/**
 * Custom fetch wrapper with explicit AbortSignal timeout so a paused or
 * unreachable Supabase project fails fast (~4s) instead of hanging 7-30s.
 */
const fetchWithTimeout: typeof fetch = async (input, init) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    ENV.SUPABASE_TIMEOUT_MS
  );

  try {
    if (init?.signal) {
      init.signal.addEventListener("abort", () => controller.abort(), {
        once: true,
      });
    }
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
};

export const supabase = createClient(
  ENV.SUPABASE_URL || "https://placeholder.supabase.co",
  ENV.SUPABASE_ANON_KEY || "placeholder-anon-key",
  {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: fetchWithTimeout },
  }
);

export const supabaseAdmin = createClient(
  ENV.SUPABASE_URL || "https://placeholder.supabase.co",
  ENV.SUPABASE_SERVICE_ROLE_KEY || "placeholder-service-key",
  {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: fetchWithTimeout },
  }
);
