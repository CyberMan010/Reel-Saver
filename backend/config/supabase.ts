import { createClient } from "@supabase/supabase-js";
import { ENV } from "./env";

// Public client (uses anon key — respects RLS)
export const supabase = createClient(
  ENV.SUPABASE_URL || "https://placeholder.supabase.co",
  ENV.SUPABASE_ANON_KEY || "placeholder-anon-key"
);

// Admin client (uses service_role key — bypasses RLS)
// Use ONLY on the server side for privileged operations
export const supabaseAdmin = createClient(
  ENV.SUPABASE_URL || "https://placeholder.supabase.co",
  ENV.SUPABASE_SERVICE_ROLE_KEY || "placeholder-service-key"
);
