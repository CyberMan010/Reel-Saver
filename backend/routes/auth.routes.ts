import { Router } from "express";
import * as authController from "../controllers/auth.controller";
import { authenticate, authorize } from "../middlewares/authenticate.middleware";
import { handleValidationErrors } from "../middlewares/validate.middleware";
import { authRateLimiter } from "../middlewares/rateLimiter.middleware";
import {
  registerValidators,
  loginValidators,
  refreshTokenValidators,
  changePasswordValidators,
  forgotPasswordValidators,
  resetPasswordValidators,
  updateProfileValidators,
  deleteAccountValidators,
} from "../validators/auth.validators";

const router = Router();

// ─── Public Routes ────────────────────────────────────────────────────────────

/**
 * @route   POST /api/auth/register
 * @desc    Register a new user with hashed password
 * @access  Public
 */
router.post(
  "/register",
  authRateLimiter,
  registerValidators,
  handleValidationErrors,
  authController.register
);

/**
 * @route   POST /api/auth/login
 * @desc    Login with email & password, receive JWT pair
 * @access  Public
 */
router.post(
  "/login",
  authRateLimiter,
  loginValidators,
  handleValidationErrors,
  authController.login
);

/**
 * @route   POST /api/auth/refresh
 * @desc    Refresh access token using a valid refresh token
 * @access  Public
 */
router.post(
  "/refresh",
  refreshTokenValidators,
  handleValidationErrors,
  authController.refreshTokens
);

/**
 * @route   POST /api/auth/forgot-password
 * @desc    Request a password-reset token
 * @access  Public
 */
router.post(
  "/forgot-password",
  authRateLimiter,
  forgotPasswordValidators,
  handleValidationErrors,
  authController.forgotPassword
);

/**
 * @route   POST /api/auth/reset-password
 * @desc    Reset password using a valid reset token
 * @access  Public
 */
router.post(
  "/reset-password",
  authRateLimiter,
  resetPasswordValidators,
  handleValidationErrors,
  authController.resetPassword
);

// ─── Protected Routes (any authenticated user) ────────────────────────────────

/**
 * @route   POST /api/auth/logout
 * @desc    Invalidate the refresh token (logout)
 * @access  Private
 */
router.post("/logout", authenticate, authController.logout);

/**
 * @route   GET /api/auth/me
 * @desc    Get current authenticated user's profile
 * @access  Private
 */
router.get("/me", authenticate, authController.getProfile);

/**
 * @route   PATCH /api/auth/me
 * @desc    Update current user's profile (name, email)
 * @access  Private
 */
router.patch(
  "/me",
  authenticate,
  updateProfileValidators,
  handleValidationErrors,
  authController.updateProfile
);

/**
 * @route   POST /api/auth/change-password
 * @desc    Change password (requires current password)
 * @access  Private
 */
router.post(
  "/change-password",
  authenticate,
  changePasswordValidators,
  handleValidationErrors,
  authController.changePassword
);

/**
 * @route   DELETE /api/auth/me
 * @desc    Permanently delete authenticated user's account
 * @access  Private
 */
router.delete(
  "/me",
  authenticate,
  deleteAccountValidators,
  handleValidationErrors,
  authController.deleteAccount
);

// ─── Admin-Only Routes ────────────────────────────────────────────────────────

/**
 * @route   GET /api/auth/admin/users
 * @desc    List all registered users
 * @access  Admin
 */
router.get(
  "/admin/users",
  authenticate,
  authorize("admin"),
  authController.listUsers
);

export default router;
