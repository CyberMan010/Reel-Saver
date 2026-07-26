import { body, param, query } from "express-validator";

const REEL_STATUSES = ["PENDING", "EXTRACTING", "SUMMARIZING", "DONE", "FAILED"] as const;

export const createReelValidators = [
  body("sourceUrl")
    .trim()
    .notEmpty()
    .withMessage("sourceUrl is required.")
    .isURL({ require_protocol: true })
    .withMessage("sourceUrl must be a valid URL."),
];

export const reelIdParamValidator = [
  param("id").isUUID().withMessage("id must be a valid UUID."),
];

export const listReelsValidators = [
  query("status")
    .optional()
    .isIn(REEL_STATUSES)
    .withMessage(`status must be one of: ${REEL_STATUSES.join(", ")}.`),
  query("categoryId")
    .optional()
    .isString()
    .trim()
    .notEmpty()
    .withMessage("categoryId cannot be empty."),
];
