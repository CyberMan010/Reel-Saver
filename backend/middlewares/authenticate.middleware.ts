import type { Request, Response, NextFunction } from "express";
import { verifyAccessToken } from "../utils/jwt.util";
import { sendError } from "../utils/response.util";
import type { UserRole } from "../types/auth.types";

/**
 * Middleware: Verifies the JWT access token from the Authorization header.
 * Attaches decoded payload to `req.user`.
 */
export function authenticate(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    sendError(res, "Authorization token is missing or malformed.", 401);
    return;
  }

  const token = authHeader.split(" ")[1];

  try {
    const payload = verifyAccessToken(token);

    if (payload.type !== "access") {
      sendError(res, "Invalid token type.", 401);
      return;
    }

    req.user = payload;
    next();
  } catch (err: unknown) {
    const message =
      err instanceof Error && err.name === "TokenExpiredError"
        ? "Access token has expired. Please refresh."
        : "Invalid access token.";
    sendError(res, message, 401);
  }
}

/**
 * Middleware factory: Restricts access to users with specific roles.
 * Must be used AFTER `authenticate`.
 */
export function authorize(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      sendError(res, "Unauthorized.", 401);
      return;
    }

    if (!roles.includes(req.user.role)) {
      sendError(
        res,
        `Access denied. Required role(s): ${roles.join(", ")}.`,
        403
      );
      return;
    }

    next();
  };
}
