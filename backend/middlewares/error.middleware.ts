import type { Request, Response, NextFunction } from "express";
import multer from "multer";
import { sendError } from "../utils/response.util";
import { ENV } from "../config/env";

interface AppError extends Error {
  statusCode?: number;
  code?: string;
}

export function globalErrorHandler(
  err: AppError,
  _req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction
): void {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      sendError(
        res,
        `Uploaded file exceeds the ${ENV.MAX_UPLOAD_MB}MB limit.`,
        413
      );
      return;
    }
    sendError(res, err.message, 400);
    return;
  }

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

export function notFoundHandler(req: Request, res: Response): void {
  sendError(res, `Route ${req.method} ${req.originalUrl} not found.`, 404);
}
