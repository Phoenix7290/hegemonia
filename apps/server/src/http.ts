import type express from "express";
import type { SessionIdentity } from "./auth-repository.js";
import { authenticateToken } from "./auth-service.js";

export const SESSION_COOKIE = "hegemonia_session";

export function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    const key = part.slice(0, separator).trim();
    try {
      cookies[key] = decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      continue;
    }
  }
  return cookies;
}

export function sessionTokenFromHeaders(headers: { cookie?: string }): string | undefined {
  return parseCookies(headers.cookie)[SESSION_COOKIE];
}

export function setSessionCookie(res: express.Response, token: string, expiresAt: Date): void {
  const secure = process.env.COOKIE_SECURE === "true" ? "; Secure" : "";
  res.append(
    "Set-Cookie",
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Expires=${expiresAt.toUTCString()}${secure}`
  );
}

export function clearSessionCookie(res: express.Response): void {
  const secure = process.env.COOKIE_SECURE === "true" ? "; Secure" : "";
  res.append("Set-Cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`);
}

export async function optionalIdentity(req: express.Request, res: express.Response, next: express.NextFunction) {
  try {
    res.locals.identity = await authenticateToken(sessionTokenFromHeaders(req.headers));
    next();
  } catch (error) {
    next(error);
  }
}

export function requireIdentity(_req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!res.locals.identity) {
    res.status(401).json({ error: "Entre na sua conta para continuar.", code: "authentication_required" });
    return;
  }
  next();
}

export function identity(res: express.Response): SessionIdentity {
  return res.locals.identity as SessionIdentity;
}

export function createRateLimiter(options: { windowMs: number; max: number }) {
  const attempts = new Map<string, { count: number; resetAt: number }>();
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const now = Date.now();
    const key = `${req.ip ?? "unknown"}:${req.path}`;
    const current = attempts.get(key);
    if (!current || current.resetAt <= now) {
      attempts.set(key, { count: 1, resetAt: now + options.windowMs });
    } else {
      current.count += 1;
    }
    const entry = attempts.get(key)!;
    res.setHeader("RateLimit-Limit", options.max);
    res.setHeader("RateLimit-Remaining", Math.max(0, options.max - entry.count));
    if (entry.count > options.max) {
      res.setHeader("Retry-After", Math.ceil((entry.resetAt - now) / 1000));
      res.status(429).json({ error: "Muitas tentativas. Aguarde antes de tentar novamente.", code: "rate_limited" });
      return;
    }
    if (attempts.size > 10_000) {
      for (const [storedKey, value] of attempts) if (value.resetAt <= now) attempts.delete(storedKey);
    }
    next();
  };
}
