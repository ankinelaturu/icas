/**
 * @file Express app for the helix-cu synthetic credit-union UI.
 *
 * Demo target only: fake members, no real credentials or PII. Layout is
 * div-based (no tables) so discovery is not locked to the icas-bank shell.
 * Does not listen — tests import this handler without binding a port.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import express, { type Express, type Request, type Response } from "express";

import {
  getMember,
  getShare,
  HoldExceedsAvailableError,
  HoldReasonRequiredError,
  InvalidHoldAmountError,
  placeHold,
  SYSTEM_DATE,
  type MemberRecord,
  type ShareRecord,
} from "./members.js";
import { renderPage } from "./render.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

export interface HelixCuAppOptions {
  readonly pagesDir?: string;
  readonly publicDir?: string;
}

/**
 * Build the helix-cu request handler. Does not listen.
 */
export function createHelixCuApp(options: HelixCuAppOptions = {}): Express {
  const pagesDir = options.pagesDir ?? join(packageRoot, "pages");
  const publicDir = options.publicDir ?? join(packageRoot, "public");
  const app = express();
  app.disable("x-powered-by");
  app.use(express.urlencoded({ extended: false }));
  app.use(express.static(publicDir, { etag: false, cacheControl: false }));

  const page = (fileName: string, vars?: Record<string, string>): string =>
    renderPage(pagesDir, fileName, vars);

  app.get("/favicon.ico", (_req, res) => {
    res.status(204).end();
  });

  app.get("/", (_req, res) => {
    sendHtml(res, page("index.html"));
  });

  app.get("/members.htm", (_req, res) => {
    sendHtml(res, page("members.html"));
  });

  app.get("/holds.htm", (req, res) => {
    const memberId = queryString(req, "txtMember");
    if (memberId.length > 0) {
      redirectMember(res, memberId);
      return;
    }
    sendHtml(res, page("find.html"));
  });

  app.post("/holds.htm", (req, res) => {
    redirectMember(res, formString(req.body, "txtMember"));
  });

  app.get("/holds/shares.htm", (req, res) => {
    const member = memberFromQuery(req);
    if (member === undefined) {
      redirectNotFound(res, queryString(req, "mb"));
      return;
    }
    sendHtml(res, page("shares.html", memberVars(member)));
  });

  app.get("/holds/place.htm", (req, res) => {
    const found = shareFromQuery(req);
    if (found === undefined) {
      redirectNotFound(res, queryString(req, "mb"));
      return;
    }
    sendHtml(res, holdFormPage(pagesDir, found.member, found.share, "", "", ""));
  });

  app.post("/holds/place.htm", (req, res) => {
    const memberId = formString(req.body, "hidMb") || queryString(req, "mb");
    const shareId = formString(req.body, "hidSh") || queryString(req, "sh");
    const found = getShare(memberId, shareId);
    if (found === undefined) {
      redirectNotFound(res, memberId);
      return;
    }
    const amountRaw = formString(req.body, "txtAmt");
    const reasonRaw = formString(req.body, "txtReason");
    try {
      const quote = placeHold(found.member, found.share, amountRaw, reasonRaw);
      sendHtml(
        res,
        page("confirm.html", {
          ...shareVars(found.member, found.share),
          holdAmount: quote.holdAmount,
          availableAfter: quote.availableAfter,
          holdConfirmationId: quote.holdConfirmationId,
          holdExpires: quote.holdExpires,
          reason: quote.reason,
          processingDate: quote.processingDate,
        }),
      );
    } catch (error) {
      sendHtml(
        res,
        holdFormPage(
          pagesDir,
          found.member,
          found.share,
          amountRaw,
          reasonRaw,
          holdErrorMessage(error),
        ),
      );
    }
  });

  app.get("/holds/notfound.htm", (req, res) => {
    const mb = queryString(req, "mb");
    sendHtml(
      res,
      page("not-found.html", {
        memberId: mb.length > 0 ? mb : "(blank)",
      }),
    );
  });

  app.get("/drafts.htm", (_req, res) => {
    sendHtml(res, page("drafts.html"));
  });
  app.get("/cards.htm", (_req, res) => {
    sendHtml(res, page("cards.html"));
  });
  app.get("/help.htm", (_req, res) => {
    sendHtml(res, page("help.html"));
  });

  return app;
}

function holdFormPage(
  pagesDir: string,
  member: MemberRecord,
  share: ShareRecord,
  amountRaw: string,
  reasonRaw: string,
  errorMessage: string,
): string {
  return renderPage(pagesDir, "place.html", {
    ...shareVars(member, share),
    txtAmt: amountRaw,
    txtReason: reasonRaw,
    errorMessage,
    errorDisplay: errorMessage.length > 0 ? "" : "display:none",
  });
}

function memberVars(member: MemberRecord): Record<string, string> {
  const share01 = member.shares[0];
  const share02 = member.shares[1];
  return {
    memberId: member.memberId,
    shortName: member.shortName,
    branch: member.branch,
    processingDate: SYSTEM_DATE,
    share01Href:
      share01 === undefined
        ? "#"
        : `/holds/place.htm?mb=${encodeURIComponent(member.memberId)}&sh=${encodeURIComponent(share01.shareId)}`,
    share01Id: share01?.shareId ?? "",
    share01Desc: share01?.description ?? "",
    share01Avail: share01 === undefined ? "" : share01.availableBalance.toFixed(2),
    share02Href:
      share02 === undefined
        ? "#"
        : `/holds/place.htm?mb=${encodeURIComponent(member.memberId)}&sh=${encodeURIComponent(share02.shareId)}`,
    share02Id: share02?.shareId ?? "",
    share02Desc: share02?.description ?? "",
    share02Avail: share02 === undefined ? "" : share02.availableBalance.toFixed(2),
    share02Display: share02 === undefined ? "display:none" : "",
  };
}

function shareVars(member: MemberRecord, share: ShareRecord): Record<string, string> {
  return {
    memberId: member.memberId,
    shortName: member.shortName,
    branch: member.branch,
    shareId: share.shareId,
    shareDescription: share.description,
    ledgerBalance: share.ledgerBalance.toFixed(2),
    availableBalance: share.availableBalance.toFixed(2),
    processingDate: SYSTEM_DATE,
  };
}

function redirectMember(res: Response, memberId: string): void {
  const id = memberId.trim();
  if (id.length === 0) {
    res.redirect("/holds.htm");
    return;
  }
  if (getMember(id) === undefined) {
    redirectNotFound(res, id);
    return;
  }
  res.redirect(`/holds/shares.htm?mb=${encodeURIComponent(id)}`);
}

function redirectNotFound(res: Response, mb: string): void {
  res.redirect(`/holds/notfound.htm?mb=${encodeURIComponent(mb)}`);
}

function memberFromQuery(req: Request): MemberRecord | undefined {
  return getMember(queryString(req, "mb"));
}

function shareFromQuery(req: Request): ReturnType<typeof getShare> {
  return getShare(queryString(req, "mb"), queryString(req, "sh"));
}

function queryString(req: Request, key: string): string {
  const value = req.query[key];
  return typeof value === "string" ? value.trim() : "";
}

function formString(body: unknown, key: string): string {
  if (body === null || typeof body !== "object") {
    return "";
  }
  const value = (body as Record<string, unknown>)[key];
  return typeof value === "string" ? value.trim() : "";
}

function holdErrorMessage(error: unknown): string {
  if (error instanceof InvalidHoldAmountError) {
    return "Hold Amt not recognized. Use dollars and cents (example 250.00).";
  }
  if (error instanceof HoldExceedsAvailableError) {
    return `Hold Amt cannot exceed available ${error.available.toFixed(2)}.`;
  }
  if (error instanceof HoldReasonRequiredError) {
    return "Reason is required.";
  }
  return "Unable to place hold.";
}

function sendHtml(res: Response, html: string): void {
  res.type("html").send(html);
}
