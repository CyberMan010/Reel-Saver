import dotenv from "dotenv";
import path from "path";

const envPaths = [path.resolve(process.cwd(), ".env"), path.resolve(process.cwd(), "../.env")];

for (const envPath of envPaths) {
  dotenv.config({ path: envPath });
}

function getEnv(key: string, fallback = ""): string {
  const value = process.env[key];
  return value ?? fallback;
}

function requireEnv(key: string): string {
  const value = getEnv(key);
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

export const ENV = {
  PORT: Number(getEnv("PORT", "4000")),
  NODE_ENV: getEnv("NODE_ENV", "development"),

  // Supabase
  SUPABASE_URL: getEnv("SUPABASE_URL"),
  SUPABASE_ANON_KEY: getEnv("SUPABASE_ANON_KEY", getEnv("SUPABASE_PUBLISHABLE_KEY")),
  SUPABASE_SERVICE_ROLE_KEY: getEnv("SUPABASE_SERVICE_ROLE_KEY", getEnv("SUPABASE_SECRET_KEY")),

  // JWT
  JWT_SECRET: getEnv("JWT_SECRET", "super-secret-jwt-key-change-in-production"),
  JWT_EXPIRES_IN: getEnv("JWT_EXPIRES_IN", "15m"),
  JWT_REFRESH_SECRET: getEnv("JWT_REFRESH_SECRET", "super-secret-refresh-key-change-in-production"),
  JWT_REFRESH_EXPIRES_IN: getEnv("JWT_REFRESH_EXPIRES_IN", "7d"),

  // Bcrypt
  BCRYPT_SALT_ROUNDS: Number(getEnv("BCRYPT_SALT_ROUNDS", "12")),

  // CORS
  ALLOWED_ORIGINS: getEnv("ALLOWED_ORIGINS", "http://localhost:3000,http://localhost:4000").split(","),
} as const;
