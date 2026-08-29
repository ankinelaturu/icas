/**
 * @file Express app for the loki-bank synthetic core-banking UI.
 *
 * Second synthetic institution of the **same** fictional Vendor+Product as
 * icas-bank (CU branding, small route drift). Overlay (`?inject=`) sits on
 * **search**, not loan details, so adaptation has a real step mismatch.
 * Same fake loan ids so capability typed inputs still apply. Does not listen.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import express, { type Express, type Request, type Response } from "express";

import {
  calculatePayoff,
  getLoan,
  InvalidPayoffDateError,
  type LoanRecord,
  PayoffDateInPastError,
  PayoffNotEligibleError,
  SYSTEM_DATE,
} from "./loans.js";
import {
  attachInjectMode,
  injectModeFrom,
  maybeDelayInjectWait,
  overlayTemplateVars,
} from "./inject-mode.js";
import { renderPage } from "./render.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

export interface LokiBankAppOptions {
  /** Override so tests can point at a fixture tree without the package `pages/`. */
  readonly pagesDir?: string;
  readonly publicDir?: string;
}

/**
 * Build the loki-bank request handler. Does not listen.
 *
 * @param options - Optional page/static roots for tests
 * @returns An Express app ready for `listen` or `supertest`
 */
export function createLokiBankApp(options: LokiBankAppOptions = {}): Express {
  const pagesDir = options.pagesDir ?? join(packageRoot, "pages");
  const publicDir = options.publicDir ?? join(packageRoot, "public");
  const app = express();
  app.disable("x-powered-by");
  app.use(express.urlencoded({ extended: false }));
  // Disable caching so discovery/replay always observe the current HTML, not a stale copy.
  app.use(express.static(publicDir, { etag: false, cacheControl: false }));
  // Cookie/query must apply before any route so overlays survive redirects.
  app.use(attachInjectMode);

  const page = (fileName: string, vars?: Record<string, string>): string =>
    renderPage(pagesDir, fileName, vars);

  app.get("/favicon.ico", (_req, res) => {
    res.status(204).end();
  });

  app.get("/", (_req, res) => {
    sendHtml(res, page("index.html"));
  });

  app.get("/lending.htm", (_req, res) => {
    sendHtml(res, page("lending.html"));
  });

  app.get("/lending/search.htm", async (req, res) => {
    const mode = injectModeFrom(res);
    if (mode !== undefined) {
      // Inject wins over a populated `txtAcct`: the overlay must be visible
      // before inquiry. This is the Loki-vs-icas-bank step drift.
      await maybeDelayInjectWait(mode);
      sendHtml(
        res,
        page("search.html", overlayTemplateVars(mode, "/lending/search.htm?inject=clear")),
      );
      return;
    }
    const acct = queryString(req, "txtAcct");
    if (acct.length > 0) {
      redirectInquiry(res, acct);
      return;
    }
    sendHtml(res, page("search.html", overlayTemplateVars(undefined, "/lending/search.htm?inject=clear")));
  });

  app.post("/lending/search.htm", (req, res) => {
    if (injectModeFrom(res) !== undefined) {
      // Bounce to GET so a POST cannot skip the overlay and complete search.
      res.redirect("/lending/search.htm");
      return;
    }
    redirectInquiry(res, formString(req.body, "txtAcct"));
  });

  app.get("/lending/account.htm", (req, res) => {
    const loan = loanFromQuery(req);
    if (loan === undefined) {
      redirectNotFound(res, queryString(req, "ln"));
      return;
    }
    sendHtml(res, page("account.html", loanVars(loan)));
  });

  app.get("/lending/payoff.htm", (req, res) => {
    const loan = loanFromQuery(req);
    if (loan === undefined) {
      redirectNotFound(res, queryString(req, "ln"));
      return;
    }
    sendHtml(res, payoffPage(pagesDir, loan, "", ""));
  });

  app.post("/lending/payoff.htm", (req, res) => {
    // Prefer the hidden field so a dropped query string does not lose the account.
    const ln = formString(req.body, "hidLn") || queryString(req, "ln");
    const loan = getLoan(ln);
    if (loan === undefined) {
      redirectNotFound(res, ln);
      return;
    }
    const dateRaw = formString(req.body, "dtPayoff");
    try {
      const quote = calculatePayoff(loan, dateRaw);
      sendHtml(
        res,
        page("statement.html", {
          ...loanVars(loan),
          payoffDate: quote.payoffDate,
          days: String(quote.days),
          principalBalance: quote.principalBalance,
          perDiemInterest: quote.perDiemInterest,
          interestThroughPayoff: quote.interestThroughPayoff,
          totalPayoffAmount: quote.totalPayoffAmount,
          processingDate: SYSTEM_DATE,
        }),
      );
    } catch (error) {
      // Re-render the form with the operator's input so they can correct it.
      sendHtml(res, payoffPage(pagesDir, loan, dateRaw, payoffErrorMessage(error)));
    }
  });

  app.get("/lending/notfound.htm", (req, res) => {
    const ln = queryString(req, "ln");
    sendHtml(
      res,
      page("not-found.html", {
        loanAccountId: ln.length > 0 ? ln : "(blank)",
      }),
    );
  });

  // Dead-end modules: discovery must observe a real menu, not a single linear path.
  app.get("/cif.htm", (_req, res) => {
    sendHtml(res, page("cif.html"));
  });
  app.get("/dp.htm", (_req, res) => {
    sendHtml(res, page("deposits.html"));
  });
  app.get("/docs.htm", (_req, res) => {
    sendHtml(res, page("documents.html"));
  });
  app.get("/rpts.htm", (_req, res) => {
    sendHtml(res, page("reports.html"));
  });
  app.get("/util.htm", (_req, res) => {
    sendHtml(res, page("utilities.html"));
  });
  app.get("/help.htm", (_req, res) => {
    sendHtml(res, page("help.html"));
  });
  app.get("/rateboard.htm", (_req, res) => {
    sendHtml(res, page("rateboard.html"));
  });

  return app;
}

/**
 * Payoff form with optional inline error. `errorDisplay` hides the banner when empty.
 */
function payoffPage(
  pagesDir: string,
  loan: LoanRecord,
  dateRaw: string,
  errorMessage: string,
): string {
  return renderPage(pagesDir, "payoff.html", {
    ...loanVars(loan),
    dtPayoff: dateRaw,
    errorMessage,
    errorDisplay: errorMessage.length > 0 ? "" : "display:none",
  });
}

/**
 * Flatten a loan into `{{token}}` strings the hand-authored HTML expects.
 */
function loanVars(loan: LoanRecord): Record<string, string> {
  return {
    loanAccountId: loan.loanAccountId,
    borrowerName: loan.borrowerName,
    status: loan.status,
    principalBalance: loan.principalBalance.toFixed(2),
    perDiemInterest: loan.perDiemInterest.toFixed(2),
    interestRatePct: loan.interestRatePct.toFixed(2),
    originationDate: loan.originationDate,
    maturityDate: loan.maturityDate,
    productDesc: loan.productDesc,
    branch: loan.branch,
    processingDate: SYSTEM_DATE,
  };
}

/**
 * Route a search to inquiry, not-found, or back to the blank form.
 *
 * Empty input returns to search rather than 404 — a blank submit is not a
 * missing account.
 */
function redirectInquiry(res: Response, acct: string): void {
  const id = acct.trim();
  if (id.length === 0) {
    res.redirect("/lending/search.htm");
    return;
  }
  if (getLoan(id) === undefined) {
    redirectNotFound(res, id);
    return;
  }
  res.redirect(`/lending/account.htm?ln=${encodeURIComponent(id)}`);
}

function redirectNotFound(res: Response, ln: string): void {
  res.redirect(`/lending/notfound.htm?ln=${encodeURIComponent(ln)}`);
}

function loanFromQuery(req: Request): LoanRecord | undefined {
  return getLoan(queryString(req, "ln"));
}

function queryString(req: Request, key: string): string {
  const value = req.query[key];
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Read a urlencoded field. Non-object bodies look like a blank field so a
 * malformed POST still renders the UI instead of throwing.
 */
function formString(body: unknown, key: string): string {
  if (body === null || typeof body !== "object") {
    return "";
  }
  const value = (body as Record<string, unknown>)[key];
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Map domain errors to operator-facing copy. Unknown errors stay generic so
 * internals do not leak into the page.
 */
function payoffErrorMessage(error: unknown): string {
  if (error instanceof InvalidPayoffDateError) {
    return "Payoff Dt not recognized. Use YYYY-MM-DD or MM/DD/YYYY.";
  }
  if (error instanceof PayoffDateInPastError) {
    return `Payoff Dt cannot be before processing date ${SYSTEM_DATE}.`;
  }
  if (error instanceof PayoffNotEligibleError) {
    return `Payoff quote not available. Account status is ${error.status}.`;
  }
  return "Unable to calculate payoff.";
}

function sendHtml(res: Response, html: string): void {
  res.type("html").send(html);
}
