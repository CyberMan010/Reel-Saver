import * as userRepo from "../repositories/user.repositories";
import { hashPassword, comparePassword, validatePasswordStrength } from "../utils/password.util";
import { generateTokenPair, verifyRefreshToken } from "../utils/jwt.util";
import { generateSecureToken, expiresInMinutes, isTokenExpired } from "../utils/token.util";
import type {
  RegisterBody,
  LoginBody,
  ChangePasswordBody,
  ForgotPasswordBody,
  ResetPasswordBody,
  UpdateProfileBody,
  PublicUser,
  AuthTokens,
  User,
} from "../types/auth.types";

// ─── Register ────────────────────────────────────────────────────────────────

export async function register(
  body: RegisterBody
): Promise<{ user: PublicUser; tokens: AuthTokens }> {
  const { name, email, password, role } = body;

  // 1. Validate password strength
  const strength = validatePasswordStrength(password);
  if (!strength.valid) {
    throw Object.assign(new Error(strength.message), { statusCode: 422 });
  }

  // 2. Check duplicate email
  const existing = await userRepo.findUserByEmail(email);
  if (existing) {
    throw Object.assign(new Error("An account with this email already exists."), {
      statusCode: 409,
    });
  }

  // 3. Hash password
  const password_hash = await hashPassword(password);

  // 4. Create user in Supabase
  const user = await userRepo.createUser({ name, email, password_hash, role });

  // 5. Generate token pair
  const tokenPayload = { userId: user.id, email: user.email, role: user.role };
  const tokens = generateTokenPair(tokenPayload);

  // 6. Persist hashed refresh token (optional — store raw for simplicity)
  await userRepo.updateRefreshToken(user.id, tokens.refreshToken);

  return { user: userRepo.toPublicUser(user), tokens };
}

// ─── Login ───────────────────────────────────────────────────────────────────

export async function login(
  body: LoginBody
): Promise<{ user: PublicUser; tokens: AuthTokens }> {
  const { email, password } = body;

  // 1. Find user
  const user = await userRepo.findUserByEmail(email);
  if (!user) {
    // Use generic message to prevent user enumeration
    throw Object.assign(new Error("Invalid email or password."), { statusCode: 401 });
  }

  // 2. Compare password
  const isMatch = await comparePassword(password, user.password_hash);
  if (!isMatch) {
    throw Object.assign(new Error("Invalid email or password."), { statusCode: 401 });
  }

  // 3. Generate tokens
  const tokenPayload = { userId: user.id, email: user.email, role: user.role };
  const tokens = generateTokenPair(tokenPayload);

  // 4. Persist refresh token
  await userRepo.updateRefreshToken(user.id, tokens.refreshToken);

  return { user: userRepo.toPublicUser(user), tokens };
}

// ─── Refresh Token ────────────────────────────────────────────────────────────

export async function refreshTokens(
  refreshToken: string
): Promise<AuthTokens> {
  // 1. Verify signature & expiry
  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    throw Object.assign(new Error("Invalid or expired refresh token."), { statusCode: 401 });
  }

  if (payload.type !== "refresh") {
    throw Object.assign(new Error("Token type mismatch."), { statusCode: 401 });
  }

  // 2. Check user exists and refresh token matches (rotation check)
  const user = await userRepo.findUserById(payload.userId);
  if (!user || user.refresh_token !== refreshToken) {
    throw Object.assign(new Error("Refresh token reuse detected. Please log in again."), {
      statusCode: 401,
    });
  }

  // 3. Rotate tokens
  const tokenPayload = { userId: user.id, email: user.email, role: user.role };
  const tokens = generateTokenPair(tokenPayload);

  await userRepo.updateRefreshToken(user.id, tokens.refreshToken);

  return tokens;
}

// ─── Logout ───────────────────────────────────────────────────────────────────

export async function logout(userId: string): Promise<void> {
  await userRepo.updateRefreshToken(userId, null);
}

// ─── Get Profile ──────────────────────────────────────────────────────────────

export async function getProfile(userId: string): Promise<PublicUser> {
  const user = await userRepo.findUserById(userId);
  if (!user) {
    throw Object.assign(new Error("User not found."), { statusCode: 404 });
  }
  return userRepo.toPublicUser(user);
}

// ─── Update Profile ───────────────────────────────────────────────────────────

export async function updateProfile(
  userId: string,
  body: UpdateProfileBody
): Promise<PublicUser> {
  // Check email uniqueness if being changed
  if (body.email) {
    const existing = await userRepo.findUserByEmail(body.email);
    if (existing && existing.id !== userId) {
      throw Object.assign(new Error("Email is already in use by another account."), {
        statusCode: 409,
      });
    }
  }

  const updated = await userRepo.updateUserProfile(userId, body);
  return userRepo.toPublicUser(updated);
}

// ─── Change Password ──────────────────────────────────────────────────────────

export async function changePassword(
  userId: string,
  body: ChangePasswordBody
): Promise<void> {
  const user = await userRepo.findUserById(userId);
  if (!user) {
    throw Object.assign(new Error("User not found."), { statusCode: 404 });
  }

  // Verify current password
  const isMatch = await comparePassword(body.currentPassword, user.password_hash);
  if (!isMatch) {
    throw Object.assign(new Error("Current password is incorrect."), { statusCode: 401 });
  }

  // Validate new password strength
  const strength = validatePasswordStrength(body.newPassword);
  if (!strength.valid) {
    throw Object.assign(new Error(strength.message), { statusCode: 422 });
  }

  if (body.currentPassword === body.newPassword) {
    throw Object.assign(new Error("New password must differ from the current password."), {
      statusCode: 422,
    });
  }

  const newHash = await hashPassword(body.newPassword);
  await userRepo.updatePassword(userId, newHash);

  // Invalidate all refresh tokens (force re-login)
  await userRepo.updateRefreshToken(userId, null);
}

// ─── Forgot Password ──────────────────────────────────────────────────────────

export async function forgotPassword(
  body: ForgotPasswordBody
): Promise<{ token: string; expiresAt: Date }> {
  const user = await userRepo.findUserByEmail(body.email);
  // Always succeed to prevent email enumeration
  if (!user) {
    return { token: "noop", expiresAt: new Date() };
  }

  const token = generateSecureToken();
  const expiresAt = expiresInMinutes(30); // 30-minute window

  await userRepo.setResetToken(user.id, token, expiresAt);

  return { token, expiresAt };
}

// ─── Reset Password ───────────────────────────────────────────────────────────

export async function resetPassword(body: ResetPasswordBody): Promise<void> {
  const user = await userRepo.findUserByResetToken(body.token);
  if (!user) {
    throw Object.assign(new Error("Invalid or expired reset token."), { statusCode: 400 });
  }

  if (!user.reset_token_expires || isTokenExpired(user.reset_token_expires)) {
    throw Object.assign(new Error("Reset token has expired. Please request a new one."), {
      statusCode: 400,
    });
  }

  const strength = validatePasswordStrength(body.newPassword);
  if (!strength.valid) {
    throw Object.assign(new Error(strength.message), { statusCode: 422 });
  }

  const newHash = await hashPassword(body.newPassword);
  await userRepo.updatePassword(user.id, newHash);
  await userRepo.updateRefreshToken(user.id, null);
}

// ─── Delete Account ───────────────────────────────────────────────────────────

export async function deleteAccount(
  userId: string,
  password: string
): Promise<void> {
  const user = await userRepo.findUserById(userId);
  if (!user) {
    throw Object.assign(new Error("User not found."), { statusCode: 404 });
  }

  const isMatch = await comparePassword(password, user.password_hash);
  if (!isMatch) {
    throw Object.assign(new Error("Password confirmation failed."), { statusCode: 401 });
  }

  await userRepo.deleteUser(userId);
}

// ─── Admin: List Users ────────────────────────────────────────────────────────

export async function listUsers(): Promise<PublicUser[]> {
  return userRepo.listAllUsers();
}
