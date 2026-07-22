import crypto from "crypto";

/**
 * Generates a cryptographically secure random token (hex string).
 * Useful for password-reset and email-verification tokens.
 * @param byteLength - Number of random bytes (default 32 → 64-char hex string).
 */
export function generateSecureToken(byteLength = 32): string {
  return crypto.randomBytes(byteLength).toString("hex");
}

/**
 * Returns a Date object offset by `minutes` from now.
 */
export function expiresInMinutes(minutes: number): Date {
  const date = new Date();
  date.setMinutes(date.getMinutes() + minutes);
  return date;
}

/**
 * Returns a Date object offset by `days` from now.
 */
export function expiresInDays(days: number): Date {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date;
}

/**
 * Checks whether a token expiry string/Date is still in the future.
 */
export function isTokenExpired(expiresAt: string | Date): boolean {
  return new Date(expiresAt) < new Date();
}
