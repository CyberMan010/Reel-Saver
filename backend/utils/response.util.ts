import type { Response } from "express";
import type { ApiResponse, ValidationError } from "../types/auth.types";

/**
 * Send a standardized success response.
 */
export function sendSuccess<T>(
  res: Response,
  message: string,
  data?: T,
  statusCode = 200
): void {
  const response: ApiResponse<T> = {
    success: true,
    message,
    ...(data !== undefined && { data }),
  };
  res.status(statusCode).json(response);
}

/**
 * Send a standardized error response.
 */
export function sendError(
  res: Response,
  message: string,
  statusCode = 400,
  errors?: ValidationError[]
): void {
  const response: ApiResponse = {
    success: false,
    message,
    ...(errors && errors.length > 0 && { errors }),
  };
  res.status(statusCode).json(response);
}
