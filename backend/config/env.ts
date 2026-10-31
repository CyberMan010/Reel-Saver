import dotenv from "dotenv";
import path from "path";

const envPaths = [
  path.resolve(process.cwd(), ".env"),
  path.resolve(process.cwd(), "../.env"),
];

for (const envPath of envPaths) {
  dotenv.config({ path: envPath });
}

function getEnv(key: string, fallback = ""): string {
  const value = process.env[key];
  return value !== undefined && value !== "" ? value : fallback;
}

export const ENV = {
  HOST: getEnv("HOST", "0.0.0.0"),
  PORT: Number(getEnv("PORT", "4000")),
  NODE_ENV: getEnv("NODE_ENV", "development"),

  // Storage & Queue Mode:
  // "auto" uses Supabase/Redis when configured & reachable, otherwise falls back
  // seamlessly to local persistent JSON storage and in-process async jobs.
  STORAGE_MODE: getEnv("STORAGE_MODE", "auto") as "auto" | "supabase" | "local",
  QUEUE_MODE: getEnv("QUEUE_MODE", "auto") as "auto" | "redis" | "memory",
  LOCAL_DATA_DIR: getEnv(
    "LOCAL_DATA_DIR",
    path.resolve(process.cwd(), "data")
  ),
  UPLOADS_DIR: getEnv(
    "UPLOADS_DIR",
    path.resolve(process.cwd(), "uploads")
  ),
  MAX_UPLOAD_MB: Number(getEnv("MAX_UPLOAD_MB", "50")),

  // Supabase
  SUPABASE_URL: getEnv("SUPABASE_URL"),
  SUPABASE_ANON_KEY: getEnv(
    "SUPABASE_ANON_KEY",
    getEnv("SUPABASE_PUBLISHABLE_KEY")
  ),
  SUPABASE_SERVICE_ROLE_KEY: getEnv(
    "SUPABASE_SERVICE_ROLE_KEY",
    getEnv("SUPABASE_SECRET_KEY")
  ),

  // JWT
  JWT_SECRET: getEnv(
    "JWT_SECRET",
    "super-secret-jwt-key-change-in-production"
  ),
  JWT_EXPIRES_IN: getEnv("JWT_EXPIRES_IN", "15m"),
  JWT_REFRESH_SECRET: getEnv(
    "JWT_REFRESH_SECRET",
    "super-secret-refresh-key-change-in-production"
  ),
  JWT_REFRESH_EXPIRES_IN: getEnv("JWT_REFRESH_EXPIRES_IN", "7d"),

  // Bcrypt
  BCRYPT_SALT_ROUNDS: Number(getEnv("BCRYPT_SALT_ROUNDS", "12")),

  // CORS
  ALLOWED_ORIGINS: getEnv(
    "ALLOWED_ORIGINS",
    "http://localhost:3000,http://localhost:4000"
  )
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),

  // Redis / BullMQ
  REDIS_URL: getEnv("REDIS_URL", ""),

  // Official Meta Graph API oEmbed (avoids unauthenticated server scraping)
  FACEBOOK_APP_ACCESS_TOKEN: getEnv("FACEBOOK_APP_ACCESS_TOKEN"),

  // Optional self-hosted or licensed external media resolver webhook (e.g. Cobalt instance)
  EXTERNAL_MEDIA_RESOLVER_URL: getEnv("EXTERNAL_MEDIA_RESOLVER_URL"),
  EXTERNAL_MEDIA_RESOLVER_KEY: getEnv("EXTERNAL_MEDIA_RESOLVER_KEY"),

  // FFmpeg & Local Whisper (100% Free, No Credit Card)
  FFMPEG_PATH: getEnv("FFMPEG_PATH"),
  PYTHON_BIN: getEnv("PYTHON_BIN", "python3"),
  WHISPER_MODEL_SIZE: getEnv("WHISPER_MODEL_SIZE", "base"),

  // Transcription provider: "auto" | "local-whisper" | "groq" | "gemini"
  TRANSCRIPTION_PROVIDER: getEnv("TRANSCRIPTION_PROVIDER", "auto") as
    | "auto"
    | "local-whisper"
    | "groq"
    | "gemini",

  // AI Summarization provider: "auto" | "groq" | "gemini" | "anthropic" | "ollama" | "heuristic"
  AI_PROVIDER: getEnv("AI_PROVIDER", "auto") as
    | "auto"
    | "groq"
    | "gemini"
    | "anthropic"
    | "ollama"
    | "heuristic",

  // Card-Free Cloud Options (Groq & Google AI Studio free tiers)
  GROQ_API_KEY: getEnv("GROQ_API_KEY"),
  GROQ_WHISPER_MODEL: getEnv("GROQ_WHISPER_MODEL", "whisper-large-v3-turbo"),
  GROQ_LLM_MODEL: getEnv("GROQ_LLM_MODEL", "llama-3.3-70b-versatile"),

  GEMINI_API_KEY: getEnv("GEMINI_API_KEY"),
  GEMINI_MODEL: getEnv("GEMINI_MODEL", "gemini-2.5-flash"),

  // Local Free LLM Option (Ollama)
  OLLAMA_BASE_URL: getEnv("OLLAMA_BASE_URL", "http://127.0.0.1:11434"),
  OLLAMA_MODEL: getEnv("OLLAMA_MODEL", "llama3.2"),

  // Anthropic (Optional paid option preserved from original repo)
  ANTHROPIC_API_KEY: getEnv("ANTHROPIC_API_KEY"),
  ANTHROPIC_MODEL: getEnv("ANTHROPIC_MODEL", "claude-sonnet-4-5"),

  ENABLE_VIDEO_TRANSCRIPTION:
    getEnv("ENABLE_VIDEO_TRANSCRIPTION", "true") === "true",
} as const;

export function isSupabaseConfigured(): boolean {
  if (ENV.STORAGE_MODE === "local") return false;
  const hasRealUrl =
    Boolean(ENV.SUPABASE_URL) &&
    !ENV.SUPABASE_URL.includes("placeholder.supabase.co");
  const hasRealKey =
    Boolean(ENV.SUPABASE_SERVICE_ROLE_KEY) &&
    ENV.SUPABASE_SERVICE_ROLE_KEY !== "placeholder-service-key";
  if (ENV.STORAGE_MODE === "supabase") {
    return true;
  }
  return hasRealUrl && hasRealKey;
}
