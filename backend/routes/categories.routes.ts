import { Router } from "express";
import * as categoriesController from "../controllers/categories.controller";
import { authenticate } from "../middlewares/authenticate.middleware";
import { handleValidationErrors } from "../middlewares/validate.middleware";
import {
  categoryIdParamValidators,
  createCategoryValidators,
  renameCategoryValidators,
} from "../validators/categories.validators";

const router = Router();

router.use(authenticate);

/**
 * @route   GET /api/categories
 * @desc    List user's categories with reel counts + suggested default categories
 */
router.get("/", categoriesController.listCategories);

/**
 * @route   POST /api/categories
 * @desc    Create a new category
 */
router.post(
  "/",
  createCategoryValidators,
  handleValidationErrors,
  categoriesController.createCategory
);

/**
 * @route   PATCH /api/categories/:id
 * @desc    Rename an existing category (updates across all its reels)
 */
router.patch(
  "/:id",
  renameCategoryValidators,
  handleValidationErrors,
  categoriesController.renameCategory
);

/**
 * @route   DELETE /api/categories/:id
 * @desc    Delete a category and unassign its reels
 */
router.delete(
  "/:id",
  categoryIdParamValidators,
  handleValidationErrors,
  categoriesController.deleteCategory
);

export default router;
