import { body } from "express-validator";

export const registerValidators = [
  body("name")
    .trim()
    .notEmpty().withMessage("Name is required.")
    .isLength({ min: 2, max: 60 }).withMessage("Name must be between 2 and 60 characters."),

  body("email")
    .trim()
    .notEmpty().withMessage("Email is required.")
    .isEmail().withMessage("Please provide a valid email address.")
    .normalizeEmail(),

  body("password")
    .notEmpty().withMessage("Password is required.")
    .isLength({ min: 8 }).withMessage("Password must be at least 8 characters."),

  body("role")
    .optional()
    .isIn(["user", "admin", "moderator"]).withMessage("Role must be user, admin, or moderator."),
];

export const loginValidators = [
  body("email")
    .trim()
    .notEmpty().withMessage("Email is required.")
    .isEmail().withMessage("Please provide a valid email address.")
    .normalizeEmail(),

  body("password")
    .notEmpty().withMessage("Password is required."),
];

export const refreshTokenValidators = [
  body("refreshToken")
    .notEmpty().withMessage("Refresh token is required.")
    .isString().withMessage("Refresh token must be a string."),
];

export const changePasswordValidators = [
  body("currentPassword")
    .notEmpty().withMessage("Current password is required."),

  body("newPassword")
    .notEmpty().withMessage("New password is required.")
    .isLength({ min: 8 }).withMessage("New password must be at least 8 characters."),
];

export const forgotPasswordValidators = [
  body("email")
    .trim()
    .notEmpty().withMessage("Email is required.")
    .isEmail().withMessage("Please provide a valid email address.")
    .normalizeEmail(),
];

export const resetPasswordValidators = [
  body("token")
    .notEmpty().withMessage("Reset token is required.")
    .isString().withMessage("Reset token must be a string."),

  body("newPassword")
    .notEmpty().withMessage("New password is required.")
    .isLength({ min: 8 }).withMessage("New password must be at least 8 characters."),
];

export const updateProfileValidators = [
  body("name")
    .optional()
    .trim()
    .isLength({ min: 2, max: 60 }).withMessage("Name must be between 2 and 60 characters."),

  body("email")
    .optional()
    .trim()
    .isEmail().withMessage("Please provide a valid email address.")
    .normalizeEmail(),
];

export const deleteAccountValidators = [
  body("password")
    .notEmpty().withMessage("Password confirmation is required."),
];
