import type { NextFunction, Request, Response } from "express";

type HttpError = Error & { status?: number; statusCode?: number };

// sso.auth() forwards real authentication failures here via next(err).
export function authErrorHandler(
  err: HttpError,
  _req: Request,
  res: Response,
  _next: NextFunction
) {
  const status = err.status ?? err.statusCode ?? 401;
  res.status(status).json({
    error: "authentication_failed",
    message: err.message ?? "Windows authentication failed.",
  });
}
