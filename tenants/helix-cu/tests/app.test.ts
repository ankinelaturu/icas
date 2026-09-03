/**
 * @file HTTP tests for the helix-cu tenant pages.
 */

import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

import { afterEach, describe, expect, it } from "vitest";

import { createHelixCuApp } from "../src/app.js";

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

describe("helix-cu HTTP", () => {
  it("serves home as authored div HTML with a linked stylesheet and no tables", async () => {
    const baseUrl = await listen();
    const response = await fetch(`${baseUrl}/`);
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).toContain("HELIX CREDIT UNION");
    expect(html).toContain("Vendor: HELIX");
    expect(html).toContain("Product: MS 2.14.03");
    expect(html).toContain("Licensed product: HELIX MEMBER OPS");
    expect(html).toContain('href="/styles.css"');
    expect(html).not.toMatch(/<table/i);
    expect(html).not.toMatch(/__NEXT_DATA__|data-reactroot|@vite\/client/i);
    const css = await fetch(`${baseUrl}/styles.css`);
    expect(css.status).toBe(200);
    expect(css.headers.get("content-type")).toMatch(/text\/css/i);
  });

  it("walks Home → Member Services → Share Holds → Find → Primary Share → Place Hold", async () => {
    const baseUrl = await listen();
    const home = await (await fetch(`${baseUrl}/`)).text();
    expect(home).toContain('href="/members.htm"');
    expect(home).not.toMatch(/<table/i);

    const members = await (await fetch(`${baseUrl}/members.htm`)).text();
    expect(members).toContain("Share Holds");
    expect(members).toContain('href="/holds.htm"');

    const find = await (await fetch(`${baseUrl}/holds.htm`)).text();
    expect(find).toContain("Member #");
    expect(find).toContain('value="Find Member"');

    const searched = await fetch(`${baseUrl}/holds.htm`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "txtMember=441122",
      redirect: "manual",
    });
    expect(searched.status).toBe(302);
    expect(searched.headers.get("location")).toBe("/holds/shares.htm?mb=441122");

    const shares = await (await fetch(`${baseUrl}/holds/shares.htm?mb=441122`)).text();
    expect(shares).toContain("Primary Share");
    expect(shares).toContain("/holds/place.htm?mb=441122&amp;sh=01");
    expect(shares).not.toMatch(/<table/i);

    const confirm = await fetch(`${baseUrl}/holds/place.htm`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "hidMb=441122&hidSh=01&txtAmt=250.00&txtReason=pending+debit+card+authorization",
    });
    const html = await confirm.text();
    expect(confirm.status).toBe(200);
    expect(html).toContain("Hold Confirmation");
    expect(html).toContain("HLD-441122-01-25000");
    expect(html).toContain("Available After Hold");
    expect(html).toContain("1590.50");
    expect(html).toContain("Hold Expires");
    expect(html).toContain("2026-09-10");
    expect(html).not.toMatch(/<table/i);
  });

  it("shows a domain not-found page for an unknown member", async () => {
    const baseUrl = await listen();
    const searched = await fetch(`${baseUrl}/holds.htm`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "txtMember=000000",
      redirect: "follow",
    });
    const html = await searched.text();
    expect(html).toContain("No member record found");
    expect(html).toContain("000000");
    expect(html).not.toContain("Internal Server Error");
  });
});

async function listen(): Promise<string> {
  const app = createHelixCuApp();
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
