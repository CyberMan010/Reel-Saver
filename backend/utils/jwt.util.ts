import jwt from "jsonwebtoken";
import { ENV } from "../config/env";
import type { TokenPayload, AuthTokens } from "../types/auth.types";

/**
 * Generates a signed JWT access token.
 */
export function generateAccessToken(payload: Omit<TokenPayload, "type">): string {
  return jwt.sign(
    { ...payload, type: "access" } as TokenPayload,
    ENV.JWT_SECRET,
    { expiresIn: ENV.JWT_EXPIRES_IN as jwt.SignOptions["expiresIn"] }
  );
}

/**
 * Generates a signed JWT refresh token.
 */
export function generateRefreshToken(payload: Omit<TokenPayload, "type">): string {
  return jwt.sign(
    { ...payload, type: "refresh" } as TokenPayload,
    ENV.JWT_REFRESH_SECRET,
    { expiresIn: ENV.JWT_REFRESH_EXPIRES_IN as jwt.SignOptions["expiresIn"] }
  );
}

/**
 * Generates both access and refresh tokens.
 */
export function generateTokenPair(
  payload: Omit<TokenPayload, "type">
): AuthTokens {
  return {
    accessToken: generateAccessToken(payload),
    refreshToken: generateRefreshToken(payload),
  };
}

/**
 * Verifies and decodes a JWT access token.
 * @throws JsonWebTokenError or TokenExpiredError on failure.
 */
export function verifyAccessToken(token: string): TokenPayload {
  return jwt.verify(token, ENV.JWT_SECRET) as TokenPayload;
}

/**
 * Verifies and decodes a JWT refresh token.
 * @throws JsonWebTokenError or TokenExpiredError on failure.
 */
export function verifyRefreshToken(token: string): TokenPayload {
  return jwt.verify(token, ENV.JWT_REFRESH_SECRET) as TokenPayload;
}

/**
 * Decodes a JWT without verifying the signature (useful for debugging).
 */
export function decodeToken(token: string): TokenPayload | null {
  return jwt.decode(token) as TokenPayload | null;
}
