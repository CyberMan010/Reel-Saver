import type { Request, Response, NextFunction } from "express";
import { sendError } from "../utils/response.util";
import { ENV } from "../config/env";

interface AppError extends Error {
  statusCode?: number;
}

/**
 * Global error handler middleware.
 * Must be registered LAST in the Express app (after all routes).
 */
export function globalErrorHandler(
  err: AppError,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction
): void {
  const statusCode = err.statusCode ?? 500;
  const message =
    statusCode === 500 && ENV.NODE_ENV === "production"
      ? "Internal server error."
      : err.message || "Something went wrong.";

  if (statusCode === 500) {
    console.error("[GlobalErrorHandler]", err);
  }

  sendError(res, message, statusCode);
}

/**
 * 404 handler — placed before globalErrorHandler.
 */
export function notFoundHandler(req: Request, res: Response): void {
  sendError(res, `Route ${req.method} ${req.originalUrl} not found.`, 404);
}
