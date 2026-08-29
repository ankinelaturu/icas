/**
 * @file Opt-in demo overlays: ?inject=wait | hitl, persisted on a cookie.
 */

import type { NextFunction, Request, Response } from "express";

export const INJECT_QUERY = "inject";
export const INJECT_COOKIE = "inject";
export const INJECT_WAIT_DELAY_MS = 400;

export type InjectMode = "wait" | "hitl";

/**
 * Read query/cookie, set or clear the cookie, and optionally redirect after clear.
 */
export function applyInject(
  req: Request,
  res: Response,
): { mode: InjectMode | undefined; redirectTo: string | undefined } {
  const raw = queryValue(req, INJECT_QUERY);
  if (raw === "clear") {
    expireCookie(res);
    return { mode: undefined, redirectTo: urlWithoutInject(req) };
  }
  if (raw === "wait" || raw === "hitl") {
    setCookie(res, raw);
    return { mode: raw, redirectTo: undefined };
  }
  return { mode: cookieMode(req), redirectTo: undefined };
}

/**
 * Overlay display tokens for hand-authored HTML (values are CSS, not markup).
 */
export function overlayTemplateVars(
  mode: InjectMode | undefined,
  dismissHref: string,
): Record<string, string> {
  return {
    waitStyle: mode === "wait" ? "" : "display:none",
    hitlStyle: mode === "hitl" ? "" : "display:none",
    workStyle: mode === undefined ? "" : "display:none",
    dismissHref,
  };
}

export function injectModeFrom(res: Response): InjectMode | undefined {
  const value = res.locals["injectMode"];
  return value === "wait" || value === "hitl" ? value : undefined;
}

export async function maybeDelayInjectWait(
  mode: InjectMode | undefined,
): Promise<void> {
  if (mode !== "wait") {
    return;
  }
  await new Promise<void>((resolve) => {
    setTimeout(resolve, INJECT_WAIT_DELAY_MS);
  });
}

export function attachInjectMode(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const applied = applyInject(req, res);
  if (applied.redirectTo !== undefined) {
    res.redirect(applied.redirectTo);
    return;
  }
  res.locals["injectMode"] = applied.mode;
  next();
}

function queryValue(req: Request, key: string): string {
  const value = req.query[key];
  return typeof value === "string" ? value.trim() : "";
}

function urlWithoutInject(req: Request): string {
  const url = new URL(req.originalUrl, "http://127.0.0.1");
  url.searchParams.delete(INJECT_QUERY);
  return `${url.pathname}${url.search}`;
}

function cookieMode(req: Request): InjectMode | undefined {
  const header = req.headers.cookie;
  if (header === undefined || header.length === 0) {
    return undefined;
  }
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    const name = trimmed.slice(0, eq);
    if (name !== INJECT_COOKIE) {
      continue;
    }
    const value = decodeURIComponent(trimmed.slice(eq + 1));
    if (value === "wait" || value === "hitl") {
      return value;
    }
  }
  return undefined;
}

function setCookie(res: Response, mode: InjectMode): void {
  res.append("Set-Cookie", `${INJECT_COOKIE}=${mode}; Path=/; HttpOnly; SameSite=Lax; Max-Age=3600`);
}

function expireCookie(res: Response): void {
  res.append("Set-Cookie", `${INJECT_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}
