import type { Request, Response, NextFunction } from "express";
import * as authService from "../services/auth.service";
import { sendSuccess, sendError } from "../utils/response.util";
import type {
  RegisterBody,
  LoginBody,
  ChangePasswordBody,
  ForgotPasswordBody,
  ResetPasswordBody,
  UpdateProfileBody,
} from "../types/auth.types";

// ─── Register ────────────────────────────────────────────────────────────────

export async function register(
  req: Request<object, object, RegisterBody>,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await authService.register(req.body);
    sendSuccess(res, "Account created successfully.", result, 201);
  } catch (err) {
    next(err);
  }
}

// ─── Login ───────────────────────────────────────────────────────────────────

export async function login(
  req: Request<object, object, LoginBody>,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await authService.login(req.body);
    sendSuccess(res, "Logged in successfully.", result);
  } catch (err) {
    next(err);
  }
}

// ─── Refresh Tokens ───────────────────────────────────────────────────────────

export async function refreshTokens(
  req: Request<object, object, { refreshToken: string }>,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { refreshToken } = req.body;
    const tokens = await authService.refreshTokens(refreshToken);
    sendSuccess(res, "Tokens refreshed successfully.", { tokens });
  } catch (err) {
    next(err);
  }
}

// ─── Logout ───────────────────────────────────────────────────────────────────

export async function logout(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    await authService.logout(req.user!.userId);
    sendSuccess(res, "Logged out successfully.");
  } catch (err) {
    next(err);
  }
}

// ─── Get Profile ──────────────────────────────────────────────────────────────

export async function getProfile(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const user = await authService.getProfile(req.user!.userId);
    sendSuccess(res, "Profile retrieved successfully.", { user });
  } catch (err) {
    next(err);
  }
}

// ─── Update Profile ───────────────────────────────────────────────────────────

export async function updateProfile(
  req: Request<object, object, UpdateProfileBody>,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const user = await authService.updateProfile(req.user!.userId, req.body);
    sendSuccess(res, "Profile updated successfully.", { user });
  } catch (err) {
    next(err);
  }
}

// ─── Change Password ──────────────────────────────────────────────────────────

export async function changePassword(
  req: Request<object, object, ChangePasswordBody>,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    await authService.changePassword(req.user!.userId, req.body);
    sendSuccess(res, "Password changed successfully. Please log in again.");
  } catch (err) {
    next(err);
  }
}

// ─── Forgot Password ──────────────────────────────────────────────────────────

export async function forgotPassword(
  req: Request<object, object, ForgotPasswordBody>,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { token, expiresAt } = await authService.forgotPassword(req.body);

    // In production: send token via email. Here we return it for demo purposes.
    sendSuccess(
      res,
      "If an account with that email exists, a reset link has been sent.",
      { reset_token: token, expires_at: expiresAt }
    );
  } catch (err) {
    next(err);
  }
}

// ─── Reset Password ───────────────────────────────────────────────────────────

export async function resetPassword(
  req: Request<object, object, ResetPasswordBody>,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    await authService.resetPassword(req.body);
    sendSuccess(res, "Password reset successfully. You can now log in.");
  } catch (err) {
    next(err);
  }
}

// ─── Delete Account ───────────────────────────────────────────────────────────

export async function deleteAccount(
  req: Request<object, object, { password: string }>,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    await authService.deleteAccount(req.user!.userId, req.body.password);
    sendSuccess(res, "Account deleted successfully.");
  } catch (err) {
    next(err);
  }
}

// ─── Admin: List Users ────────────────────────────────────────────────────────

export async function listUsers(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const users = await authService.listUsers();
    sendSuccess(res, "Users retrieved successfully.", { users, total: users.length });
  } catch (err) {
    next(err);
  }
}
