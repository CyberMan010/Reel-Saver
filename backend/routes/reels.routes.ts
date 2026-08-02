import { Router } from "express";
import * as reelsController from "../controllers/reels.controller";
import { authenticate } from "../middlewares/authenticate.middleware";
import { handleValidationErrors } from "../middlewares/validate.middleware";
import {
  createReelValidators,
  listReelsValidators,
  reelIdParamValidator,
  updateCategoryValidators,
} from "../validators/reels.validators";

const router = Router();

router.use(authenticate);

/**
 * @route   POST /api/reels
 * @desc    Save an Instagram reel URL and enqueue AI processing
 * @access  Private
 */
router.post(
  "/",
  createReelValidators,
  handleValidationErrors,
  reelsController.createReel
);

/**
 * @route   GET /api/reels
 * @desc    List the authenticated user's saved reels
 * @access  Private
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
 * @access  Private
 */
router.get(
  "/:id",
  reelIdParamValidator,
  handleValidationErrors,
  reelsController.getReel
);

router.patch(
  "/:id/category",
  updateCategoryValidators,
  handleValidationErrors,
  reelsController.updateCategory
);

export default router;
