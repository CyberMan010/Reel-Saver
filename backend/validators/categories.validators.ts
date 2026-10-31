import { body, param } from "express-validator";

export const createCategoryValidators = [
  body("name")
    .trim()
    .notEmpty()
    .withMessage("Category name is required.")
    .isLength({ max: 80 })
    .withMessage("Category name must be 80 characters or fewer."),
];

export const renameCategoryValidators = [
  param("id")
    .isString()
    .trim()
    .notEmpty()
    .withMessage("Category id is required."),
  body("name")
    .trim()
    .notEmpty()
    .withMessage("New category name is required.")
    .isLength({ max: 80 })
    .withMessage("Category name must be 80 characters or fewer."),
];

export const categoryIdParamValidators = [
  param("id")
    .isString()
    .trim()
    .notEmpty()
    .withMessage("Category id is required."),
];
