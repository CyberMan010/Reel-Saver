import { Router } from "express";
import * as reelsController from "../controllers/reels.controller";
import { authenticate } from "../middlewares/authenticate.middleware";
import { mediaUpload } from "../middlewares/upload.middleware";
import { handleValidationErrors } from "../middlewares/validate.middleware";
import {
  createReelValidators,
  listReelsValidators,
  reelIdParamValidator,
  updateCategoryValidators,
  updateReelValidators,
} from "../validators/reels.validators";

const router = Router();

router.use(authenticate);

/**
 * @route   POST /api/reels
 * @desc    Save a Reel via Instagram URL, MP4/MP3 file upload, or both, and process in background
 */
router.post(
  "/",
  mediaUpload.single("media"),
  createReelValidators,
  handleValidationErrors,
  reelsController.createReel
);

/**
 * @route   GET /api/reels
 * @desc    List saved reels with optional status, categoryId, and search filters
 */
router.get(
  "/",
  listReelsValidators,
  handleValidationErrors,
  reelsController.listReels
);

/**
 * @route   GET /api/reels/:id
 * @desc    Get a single saved reel
 */
router.get(
  "/:id",
  reelIdParamValidator,
  handleValidationErrors,
  reelsController.getReel
);

/**
 * @route   PATCH /api/reels/:id
 * @desc    Edit any reel field (title, summary, transcript, keyPoints, notes, category)
 */
router.patch(
  "/:id",
  updateReelValidators,
  handleValidationErrors,
  reelsController.updateReel
);

/**
 * @route   PATCH /api/reels/:id/category
 * @desc    Reassign a reel's category by name
 */
router.patch(
  "/:id/category",
  updateCategoryValidators,
  handleValidationErrors,
  reelsController.updateCategory
);

/**
 * @route   POST /api/reels/:id/media
 * @desc    Attach/upload an MP4 or MP3 file to an existing reel -> convert -> transcribe -> summarize
 */
router.post(
  "/:id/media",
  reelIdParamValidator,
  handleValidationErrors,
  mediaUpload.single("media"),
  reelsController.uploadReelMedia
);

/**
 * @route   POST /api/reels/:id/resummarize
 * @desc    Regenerate AI summary & key points from current transcript/caption
 */
router.post(
  "/:id/resummarize",
  reelIdParamValidator,
  handleValidationErrors,
  reelsController.resummarizeReel
);

/**
 * @route   POST /api/reels/:id/retry
 * @desc    Retry background processing for a failed or pending reel
 */
router.post(
  "/:id/retry",
  reelIdParamValidator,
  handleValidationErrors,
  reelsController.retryReel
);

/**
 * @route   DELETE /api/reels/:id
 * @desc    Delete a saved reel and its extracted media files
 */
router.delete(
  "/:id",
  reelIdParamValidator,
  handleValidationErrors,
  reelsController.deleteReel
);

export default router;
