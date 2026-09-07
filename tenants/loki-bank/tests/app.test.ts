/**
 * @file HTTP tests for the loki-bank tenant pages.
 */

import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

import { afterEach, describe, expect, it } from "vitest";

import { createLokiBankApp } from "../src/app.js";

let server: Server | undefined;

afterEach(async () => {
  if (server === undefined) {
    return;
  }
  const closing = server;
  server = undefined;
  await new Promise<void>((resolve, reject) => {
    closing.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
});

describe("loki-bank HTTP", () => {
  it("shows the same vendor product and a different institution", async () => {
    const baseUrl = await listen();
    const html = await (await fetch(`${baseUrl}/`)).text();
    expect(html).toContain("LOKI BANK");
    expect(html).toContain("ICAS BANK CORE");
    expect(html).toContain("Vendor: ICAS BANK");
    expect(html).toContain("Product: LS 4.12.08");
    expect(html).toContain("Licensed product: ICAS BANK CORE");
    expect(html).toContain("Member Lending");
    expect(html).not.toContain('href="/lending.htm">Lending</a>');
    expect(html).not.toMatch(/__NEXT_DATA__|data-reactroot|@vite\/client/i);
  });

  it("walks Member Lending → Loan Servicing → Search → Payoff → statement", async () => {
    const baseUrl = await listen();
    const lending = await (await fetch(`${baseUrl}/lending.htm`)).text();
    expect(lending).toContain("Loan Servicing");
    expect(lending).not.toContain("Loan Account Inquiry");

    const search = await (await fetch(`${baseUrl}/lending/search.htm`)).text();
    expect(search).toContain('value="Search"');
    expect(search).not.toContain('value="Inquire"');

    const searched = await fetch(`${baseUrl}/lending/search.htm`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "txtAcct=987654",
      redirect: "manual",
    });
    expect(searched.status).toBe(302);
    expect(searched.headers.get("location")).toBe(
      "/lending/account.htm?ln=987654",
    );

    const statement = await fetch(`${baseUrl}/lending/payoff.htm`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "hidLn=987654&dtPayoff=2026-09-30",
    });
    const html = await statement.text();
    expect(statement.status).toBe(200);
    expect(html).toContain("Licensed product: ICAS BANK CORE");
    expect(html).toContain("Total Payoff Amount");
    expect(html).toContain("12563.85");
    expect(html).toContain("Principal Balance");
    expect(html).toContain("Per Diem Interest");
  });

  it("shows a domain not-found page for an unknown loan", async () => {
    const baseUrl = await listen();
    const searched = await fetch(`${baseUrl}/lending/search.htm`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "txtAcct=000000",
      redirect: "follow",
    });
    const html = await searched.text();
    expect(html).toContain("No loan record found");
    expect(html).toContain("000000");
  });

  it("hides Find a Loan behind a session-warning overlay when inject=wait", async () => {
    const baseUrl = await listen();
    const html = await (
      await fetch(`${baseUrl}/lending/search.htm?inject=wait`)
    ).text();
    expect(html).toContain('id="inject-wait" style=""');
    expect(html).toContain("Session warning");
    expect(html).toContain(">Continue</a>");
    expect(html).toContain('id="loan-work" style="display:none"');
    expect(html).not.toContain('id="loan-work" style=""');
  });

  it("does not overlay Find a Loan when inject=hitl (HITL is the statement)", async () => {
    const baseUrl = await listen();
    const html = await (
      await fetch(`${baseUrl}/lending/search.htm?inject=hitl`)
    ).text();
    expect(html).toContain('value="Search"');
    expect(html).toContain('id="inject-hitl" style="display:none"');
    expect(html).toContain('id="loan-work" style=""');
  });

  it("hides payoff statement figures behind HITL when inject=hitl", async () => {
    const baseUrl = await listen();
    const statement = await fetch(`${baseUrl}/lending/payoff.htm`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        cookie: "inject=hitl; inject_msg=Authorization%20required",
      },
      body: "hidLn=987654&dtPayoff=2026-09-30",
    });
    const html = await statement.text();
    expect(html).toContain('id="inject-hitl" style=""');
    expect(html).toContain("Authorization required");
    expect(html).toContain("human interacted");
    expect(html).toContain('id="loan-work" style="display:none"');
  });

  it("does not overlay loan details when inject is set (search wait / statement HITL)", async () => {
    const baseUrl = await listen();
    const html = await (
      await fetch(`${baseUrl}/lending/account.htm?ln=987654&inject=wait`)
    ).text();
    expect(html).toContain("Loan Details");
    expect(html).not.toContain("id=\"inject-wait\"");
  });

  it("refuses search POST until the wait overlay is cleared", async () => {
    const baseUrl = await listen();
    const blocked = await fetch(`${baseUrl}/lending/search.htm`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        cookie: "inject=wait",
      },
      body: "txtAcct=987654",
      redirect: "manual",
    });
    expect(blocked.status).toBe(302);
    expect(blocked.headers.get("location")).toBe("/lending/search.htm");
  });
});

async function listen(): Promise<string> {
  const app = createLokiBankApp();
  server = await new Promise<Server>((resolve, reject) => {
    const started = app.listen(0, "127.0.0.1");
    started.once("listening", () => {
      resolve(started);
    });
    started.once("error", reject);
  });
  const address = server.address() as AddressInfo | null;
  if (address === null || typeof address === "string") {
    throw new Error("expected a TCP address");
  }
  return `http://127.0.0.1:${String(address.port)}`;
}
