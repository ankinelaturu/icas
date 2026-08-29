/**
 * @file HTTP tests for the icas-bank tenant pages.
 */

import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

import { afterEach, describe, expect, it } from "vitest";

import { createIcasBankApp } from "./app.js";

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

describe("icas-bank HTTP", () => {
  it("serves home as authored HTML with a linked stylesheet and no framework chrome", async () => {
    const baseUrl = await listen();
    const response = await fetch(`${baseUrl}/`);
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).toContain("ICAS BANK CORE");
    expect(html).toContain('href="/styles.css"');
    expect(html).not.toMatch(/__NEXT_DATA__|data-reactroot|@vite\/client/i);
    const css = await fetch(`${baseUrl}/styles.css`);
    expect(css.status).toBe(200);
    expect(css.headers.get("content-type")).toMatch(/text\/css/i);
  });

  it("walks Home → Lending → Inquire → Payoff → statement for loan 987654", async () => {
    const baseUrl = await listen();
    const home = await (await fetch(`${baseUrl}/`)).text();
    expect(home).toContain("href=\"/lending.htm\"");

    const lending = await (await fetch(`${baseUrl}/lending.htm`)).text();
    expect(lending).toContain("Loan Account Inquiry");
    expect(lending).toContain("href=\"/lending/search.htm\"");

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

    const details = await (
      await fetch(`${baseUrl}/lending/account.htm?ln=987654`)
    ).text();
    expect(details).toContain("Loan Details");
    expect(details).toContain("Payoff");
    expect(details).toContain("12450.00");

    const statement = await fetch(`${baseUrl}/lending/payoff.htm`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "hidLn=987654&dtPayoff=2026-09-30",
    });
    const html = await statement.text();
    expect(statement.status).toBe(200);
    expect(html).toContain("Payoff Statement");
    expect(html).toContain("Total Payoff Amount");
    expect(html).toContain("12563.85");
    expect(html).toContain("Principal Balance");
    expect(html).toContain("12450.00");
    expect(html).toContain("Per Diem Interest");
    expect(html).toContain("3.45");
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
    expect(html).not.toContain("Internal Server Error");
  });
});

async function listen(): Promise<string> {
  const app = createIcasBankApp();
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
