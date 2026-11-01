import { body, param, query } from "express-validator";

const REEL_STATUSES = [
  "AWAITING_CONFIRMATION",
  "PENDING",
  "EXTRACTING",
  "TRANSCRIBING",
  "SUMMARIZING",
  "DONE",
  "FAILED",
] as const;

const MEDIA_FORMATS = ["mp3", "mp4", "skip"] as const;

export const createReelValidators = [
  body("sourceUrl")
    .optional({ values: "falsy" })
    .trim()
    .custom((val: string) => {
      if (val.startsWith("upload://")) return true;
      try {
        const parsed = new URL(val);
        return parsed.protocol === "http:" || parsed.protocol === "https:";
      } catch {
        return false;
      }
    })
    .withMessage("sourceUrl must be a valid http/https URL."),
  body("title").optional().isString().isLength({ max: 200 }),
  body("authorHandle").optional().isString().isLength({ max: 120 }),
  body("caption").optional().isString().isLength({ max: 10000 }),
  body("transcript").optional().isString().isLength({ max: 50000 }),
  body("notes").optional().isString().isLength({ max: 10000 }),
  body("categoryName").optional().isString().isLength({ max: 80 }),
  body("mediaFormat")
    .optional()
    .isIn(MEDIA_FORMATS)
    .withMessage(`mediaFormat must be one of: ${MEDIA_FORMATS.join(", ")}.`),
  body("askBeforeConvert")
    .optional()
    .custom((v) => typeof v === "boolean" || v === "true" || v === "false")
    .withMessage("askBeforeConvert must be a boolean."),
];

export const confirmConvertValidators = [
  param("id").isUUID().withMessage("id must be a valid UUID."),
  body("mediaFormat")
    .optional()
    .isIn(MEDIA_FORMATS)
    .withMessage(`mediaFormat must be one of: ${MEDIA_FORMATS.join(", ")}.`),
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
  query("search").optional().isString().isLength({ max: 200 }),
];

export const updateCategoryValidators = [
  param("id").isUUID().withMessage("id must be a valid UUID."),
  body("categoryName").isString().withMessage("categoryName must be a string."),
];

export const updateReelValidators = [
  param("id").isUUID().withMessage("id must be a valid UUID."),
  body("title")
    .optional({ nullable: true })
    .isString()
    .isLength({ max: 200 })
    .withMessage("title must be up to 200 characters."),
  body("authorHandle")
    .optional({ nullable: true })
    .isString()
    .isLength({ max: 120 }),
  body("caption")
    .optional({ nullable: true })
    .isString()
    .isLength({ max: 10000 }),
  body("transcript")
    .optional({ nullable: true })
    .isString()
    .isLength({ max: 50000 }),
  body("summary")
    .optional({ nullable: true })
    .isString()
    .isLength({ max: 10000 }),
  body("notes")
    .optional({ nullable: true })
    .isString()
    .isLength({ max: 10000 }),
  body("keyPoints")
    .optional()
    .isArray({ max: 20 })
    .withMessage("keyPoints must be an array of strings."),
  body("keyPoints.*").optional().isString(),
  body("categoryName")
    .optional({ nullable: true })
    .isString()
    .isLength({ max: 80 }),
  body("categoryId").optional({ nullable: true }).isString(),
  body("resummarize").optional().isBoolean(),
];
