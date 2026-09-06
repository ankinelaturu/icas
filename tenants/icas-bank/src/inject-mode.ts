/**
 * @file Opt-in demo overlays: ?inject=wait | hitl, persisted on cookies.
 *
 * Off by default so happy-path discovery is not blocked. The query is stored
 * on a cookie because POST and redirects drop `?inject=`. Optional `message=`
 * is stored the same way so HITL copy can match a compiled outcome phrase
 * after Home → Inquire. This tenant shows the overlay on loan details; Loki
 * Bank shows it on search — same module, different route, so adaptation has
 * a concrete step mismatch.
 */

import type { NextFunction, Request, Response } from "express";

export const INJECT_QUERY = "inject";
export const INJECT_COOKIE = "inject";
/** Query/cookie key for overlay body copy. Independent of Loki. */
export const INJECT_MESSAGE_QUERY = "message";
export const INJECT_MESSAGE_COOKIE = "inject_msg";
/** Long enough for wait-recovery to observe a stall; short enough for a demo. */
export const INJECT_WAIT_DELAY_MS = 400;
/** Cookie/query cap so a pasted phrase cannot balloon the Cookie header. */
export const INJECT_MESSAGE_MAX_CHARS = 200;

export const DEFAULT_WAIT_BODY =
  "Please wait. The host is restoring your operator session.";
export const DEFAULT_HITL_BODY =
  "Supervisor hold. Do not generate a payoff until this inquiry is released.";
export const DEFAULT_HITL_DISMISS = "Release to servicing";
/** Dismiss label when `message=` supplies HITL copy a human must click. */
export const CUSTOM_HITL_DISMISS = "human interacted";

export type InjectMode = "wait" | "hitl";

/**
 * Result of applying query/cookie inject state for this request.
 */
export interface AppliedInject {
  readonly mode: InjectMode | undefined;
  /** Overlay body when the operator supplied `message=`; otherwise undefined. */
  readonly message: string | undefined;
  readonly redirectTo: string | undefined;
}

/**
 * Read query/cookie, set or clear cookies, and optionally redirect after clear.
 *
 * Query wins so an operator can switch mode mid-session. `clear` redirects
 * to the same path without `inject` or `message` so a refresh does not re-clear.
 * Setting `wait` or `hitl` without `message=` drops a leftover phrase cookie so
 * a later wait demo cannot inherit HITL copy.
 */
export function applyInject(req: Request, res: Response): AppliedInject {
  const raw = queryValue(req, INJECT_QUERY);
  if (raw === "clear") {
    expireCookie(res);
    expireMessageCookie(res);
    return { mode: undefined, message: undefined, redirectTo: urlWithoutInject(req) };
  }
  if (raw === "wait" || raw === "hitl") {
    setCookie(res, raw);
    const fromQuery = normalizeInjectMessage(queryValue(req, INJECT_MESSAGE_QUERY));
    if (fromQuery !== undefined) {
      setMessageCookie(res, fromQuery);
      return { mode: raw, message: fromQuery, redirectTo: undefined };
    }
    // Mode-only URL: do not keep a previous HITL phrase on a wait overlay.
    expireMessageCookie(res);
    return { mode: raw, message: undefined, redirectTo: undefined };
  }
  return {
    mode: cookieMode(req),
    message: cookieMessage(req),
    redirectTo: undefined,
  };
}

/**
 * Overlay display tokens for hand-authored HTML (values are CSS or copy).
 *
 * Empty `*Style` means the overlay is visible. Pages stay hand-authored; this
 * only toggles `display` and fills body/dismiss copy. A custom wait body keeps
 * the "Session warning" heading in HTML so recoverable wait still matches.
 *
 * @param mode - Active overlay, or undefined for the happy path
 * @param dismissHref - Clear URL on the dismiss link
 * @param message - Optional body from `message=` / cookie
 */
export function overlayTemplateVars(
  mode: InjectMode | undefined,
  dismissHref: string,
  message?: string,
): Record<string, string> {
  const custom =
    message !== undefined && message.length > 0 ? message : undefined;
  const waitUsesCustom = mode === "wait" && custom !== undefined;
  const hitlUsesCustom = mode === "hitl" && custom !== undefined;
  return {
    waitStyle: mode === "wait" ? "" : "display:none",
    hitlStyle: mode === "hitl" ? "" : "display:none",
    workStyle: mode === undefined ? "" : "display:none",
    dismissHref,
    waitBody: waitUsesCustom ? custom : DEFAULT_WAIT_BODY,
    hitlBody: hitlUsesCustom ? custom : DEFAULT_HITL_BODY,
    hitlDismissLabel: hitlUsesCustom ? CUSTOM_HITL_DISMISS : DEFAULT_HITL_DISMISS,
  };
}

/**
 * Mode stashed by {@link attachInjectMode}. Undefined means no overlay.
 */
export function injectModeFrom(res: Response): InjectMode | undefined {
  const value = res.locals["injectMode"];
  return value === "wait" || value === "hitl" ? value : undefined;
}

/**
 * Custom overlay body stashed by {@link attachInjectMode}.
 *
 * @returns Normalized message, or undefined when the operator used defaults
 */
export function injectMessageFrom(res: Response): string | undefined {
  const value = res.locals["injectMessage"];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Stall only in `wait` mode so HITL does not also look like a timeout.
 */
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

/**
 * Apply inject before routes. Redirect on `clear` so handlers never see that query.
 */
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
  res.locals["injectMessage"] = applied.message;
  next();
}

/**
 * Collapse whitespace and cap length. Empty input is treated as omitted.
 *
 * @param raw - Query or decoded cookie text
 * @returns Safe overlay copy, or undefined when the operator did not supply one
 */
export function normalizeInjectMessage(raw: string): string | undefined {
  const collapsed = raw.replace(/\s+/g, " ").trim();
  if (collapsed.length === 0) {
    return undefined;
  }
  return collapsed.slice(0, INJECT_MESSAGE_MAX_CHARS);
}

function queryValue(req: Request, key: string): string {
  const value = req.query[key];
  return typeof value === "string" ? value.trim() : "";
}

function urlWithoutInject(req: Request): string {
  // Dummy origin: only pathname + search are returned; Host is unused.
  const url = new URL(req.originalUrl, "http://127.0.0.1");
  url.searchParams.delete(INJECT_QUERY);
  url.searchParams.delete(INJECT_MESSAGE_QUERY);
  return `${url.pathname}${url.search}`;
}

function cookieNamed(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (header === undefined || header.length === 0) {
    return undefined;
  }
  // Parse Cookie by hand so this tenant stays a small Express app, not a cookie stack.
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    if (trimmed.slice(0, eq) !== name) {
      continue;
    }
    try {
      return decodeURIComponent(trimmed.slice(eq + 1));
    } catch {
      // Malformed percent-encoding: treat as missing rather than crashing the page.
      return undefined;
    }
  }
  return undefined;
}

function cookieMode(req: Request): InjectMode | undefined {
  const value = cookieNamed(req, INJECT_COOKIE);
  if (value === "wait" || value === "hitl") {
    return value;
  }
  return undefined;
}

function cookieMessage(req: Request): string | undefined {
  const raw = cookieNamed(req, INJECT_MESSAGE_COOKIE);
  if (raw === undefined) {
    return undefined;
  }
  return normalizeInjectMessage(raw);
}

function setCookie(res: Response, mode: InjectMode): void {
  // HttpOnly: the overlay is server-rendered. Path=/ so every route sees the mode.
  res.append("Set-Cookie", `${INJECT_COOKIE}=${mode}; Path=/; HttpOnly; SameSite=Lax; Max-Age=3600`);
}

function expireCookie(res: Response): void {
  res.append("Set-Cookie", `${INJECT_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function setMessageCookie(res: Response, message: string): void {
  res.append(
    "Set-Cookie",
    `${INJECT_MESSAGE_COOKIE}=${encodeURIComponent(message)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=3600`,
  );
}

function expireMessageCookie(res: Response): void {
  res.append(
    "Set-Cookie",
    `${INJECT_MESSAGE_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
  );
}
