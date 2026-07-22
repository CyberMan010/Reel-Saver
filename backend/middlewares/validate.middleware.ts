import type { Request, Response, NextFunction } from "express";
import { validationResult } from "express-validator";
import { sendError } from "../utils/response.util";

/**
 * Middleware: Reads express-validator results and short-circuits with 422
 * if any validation errors were found.
 */
export function handleValidationErrors(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    const formatted = errors.array().map((err) => ({
      field: err.type === "field" ? (err as { path: string }).path : "unknown",
      message: err.msg,
    }));

    sendError(res, "Validation failed.", 422, formatted);
    return;
  }

  next();
}
