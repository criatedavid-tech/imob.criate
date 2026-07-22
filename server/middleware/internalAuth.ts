import type { NextFunction, Request, Response } from "express";
import { INTERNAL_PROXY_TOKEN, INTERNAL_PROXY_TOKEN_PREVIOUS } from "../config";
import { isInternalBearerTokenValid } from "../security/n8nGuardrails";

export function requireInternalToken(req: Request, res: Response, next: NextFunction): void {
  const validCurrent = isInternalBearerTokenValid(req.headers.authorization, INTERNAL_PROXY_TOKEN);
  const validPrevious = isInternalBearerTokenValid(req.headers.authorization, INTERNAL_PROXY_TOKEN_PREVIOUS);
  if (!validCurrent && !validPrevious) {
    res.status(401).json({ error: "Token inválido." });
    return;
  }
  next();
}
