import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { PlaywrightSurface } from "../src/playwright-surface.js";
import { SurfaceError } from "../src/surface-error.js";

const pagesDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../tests/fixtures/pages",
);

function pageUrl(name: string): string {
  return pathToFileURL(join(pagesDir, name)).href;
}

describe("PlaywrightSurface lifecycle", () => {
  const surface = new PlaywrightSurface({ headed: false });

  afterEach(async () => {
    await surface.close();
  });

  it("opens a fixture page, reads the URL, and closes", async () => {
    const url = pageUrl("home.html");
    await surface.open(url);
    expect(surface.url()).toBe(url);
    await surface.close();
    await surface.close();
    expect(() => surface.url()).toThrow(/no open page/);
  });

  it("returns visible body text without waiting", async () => {
    await surface.open(pageUrl("labeled-fields.html"));
    const text = await surface.visibleText();
    expect(text).toContain("Payoff Statement");
    expect(text).toContain("Statement total");
  });

  it("includes input submit values that innerText omits", async () => {
    await surface.open(pageUrl("submit-value.html"));
    const text = await surface.visibleText();
    expect(text).toContain("Search Loan Account");
    expect(text).toContain("Look Up");
  });
});

describe("PlaywrightSurface locate (semantic)", () => {
  const surface = new PlaywrightSurface({ headed: false, timeoutMs: 400 });

  afterEach(async () => {
    await surface.close();
  });

  it("finds a concatenated-name link by a generic chrome phrase", async () => {
    await surface.open(pageUrl("concatenated-name.html"));
    const byRole = await surface.locate({
      strategies: [{ type: "roleText", role: "link", text: "Share Holds" }],
    });
    await expect(byRole.innerText()).resolves.toMatch(/Share Holds/);
    const byText = await surface.locate({
      strategies: [{ type: "visibleText", text: "Share Holds" }],
    });
    await expect(byText.innerText()).resolves.toMatch(/Share Holds/);
  });

  it("finds visible text on the lending page", async () => {
    await surface.open(pageUrl("lending.html"));
    const control = await surface.locate({
      strategies: [{ type: "visibleText", text: "Lending Services" }],
    });
    await expect(control.innerText()).resolves.toBe("Lending Services");
  });

  it("finds a field by label", async () => {
    await surface.open(pageUrl("loan-search.html"));
    const control = await surface.locate({
      strategies: [{ type: "label", label: "Loan Account" }],
    });
    await expect(control.getAttribute("id")).resolves.toBe("loan-account");
  });

  it("tries strategies in order and uses the first match", async () => {
    await surface.open(pageUrl("loan-search.html"));
    const control = await surface.locate({
      strategies: [
        { type: "roleText", role: "button", text: "Does Not Exist" },
        { type: "label", label: "Loan Account" },
      ],
    });
    await expect(control.getAttribute("id")).resolves.toBe("loan-account");
  });

  it("fails with TARGET_NOT_FOUND when no strategy matches", async () => {
    await surface.open(pageUrl("home.html"));
    await expect(
      surface.locate({
        strategies: [{ type: "roleText", role: "button", text: "Missing" }],
      }),
    ).rejects.toMatchObject({
      name: "SurfaceError",
      code: "TARGET_NOT_FOUND",
    });
    await expect(
      surface.locate({
        strategies: [{ type: "visibleText", text: "Missing" }],
      }),
    ).rejects.toBeInstanceOf(SurfaceError);
  });
});

describe("PlaywrightSurface snapshot refs", () => {
  const surface = new PlaywrightSurface({ headed: false, timeoutMs: 400 });

  afterEach(async () => {
    await surface.close();
  });

  it("clicks a concatenated-name tile by snapshot ref and binds roleText", async () => {
    await surface.open(pageUrl("concatenated-name.html"));
    const observation = await surface.observe();
    const snapshot = String(observation.accessibilitySnapshot);
    const match = snapshot.match(
      /link "Share Holds Place a hold on available funds" \[ref=(e\d+)\]/,
    );
    expect(snapshot, "AI snapshot should stamp a ref on the tile").toMatch(/\[ref=e\d+\]/);
    expect(match?.[1], snapshot).toBeDefined();
    const ref = match?.[1] ?? "";
    const durable = await surface.bindSnapshotRef(ref);
    expect(durable.strategies[0]).toEqual({
      type: "roleText",
      role: "link",
      text: "Share Holds Place a hold on available funds",
    });
    await expect(surface.peekSnapshotRef(ref)).resolves.toMatch(/#holds/);
    const result = await surface.executeSnapshotRef(ref, {
      type: "click",
      target: { strategies: [{ type: "visibleText", text: "does-not-match" }] },
    });
    expect(result.status).toBe("ok");
  });

  it("binds an unlabeled named textbox to css [name=]", async () => {
    await surface.open(pageUrl("unlabeled-named-input.html"));
    const observation = await surface.observe();
    const snapshot = String(observation.accessibilitySnapshot);
    const match = snapshot.match(/textbox[^\n]*\[ref=((?:f\d+)?e\d+)\]/);
    expect(match?.[1], snapshot).toBeDefined();
    const ref = match?.[1] ?? "";
    const durable = await surface.bindSnapshotRef(ref);
    expect(durable.strategies).toContainEqual({
      type: "css",
      selector: 'input[name="txtMember"]',
    });
    const result = await surface.executeSnapshotRef(ref, {
      type: "fill",
      value: { literal: "441122" },
      target: { strategies: [{ type: "visibleText", text: "does-not-match" }] },
    });
    expect(result.status).toBe("ok");
  });
});

describe("PlaywrightSurface locate (fallbacks)", () => {
  const surface = new PlaywrightSurface({ headed: false, timeoutMs: 400 });

  afterEach(async () => {
    await surface.close();
  });

  it("finds a control by css after a failed semantic strategy", async () => {
    await surface.open(pageUrl("labeled-fields.html"));
    const control = await surface.locate({
      strategies: [
        { type: "roleText", role: "button", text: "Nope" },
        { type: "css", selector: "#legacy-grid" },
      ],
    });
    await expect(control.innerText()).resolves.toBe("Grid value");
  });

  it("finds a control by xpath", async () => {
    await surface.open(pageUrl("labeled-fields.html"));
    const control = await surface.locate({
      strategies: [{ type: "xpath", selector: "//*[@id='legacy-grid']" }],
    });
    await expect(control.innerText()).resolves.toBe("Grid value");
  });

  it("finds a nearby input with a relative anchor", async () => {
    await surface.open(pageUrl("labeled-fields.html"));
    const control = await surface.locate({
      strategies: [
        {
          type: "relative",
          text: "Amount due",
          xpath: "following::input[1]",
        },
      ],
    });
    await expect(control.inputValue()).resolves.toBe("34.56");
  });

  it("defaults relative to the nearest following input when xpath is omitted", async () => {
    await surface.open(pageUrl("labeled-fields.html"));
    const control = await surface.locate({
      strategies: [{ type: "relative", text: "Amount due" }],
    });
    await expect(control.inputValue()).resolves.toBe("34.56");
  });

  it("defaults relative to the following table cell for a caption|value row", async () => {
    await surface.open(pageUrl("labeled-fields.html"));
    const control = await surface.locate({
      strategies: [{ type: "relative", text: "Statement total" }],
    });
    await expect(control.innerText()).resolves.toBe("113544.40");
  });

  it("skips a wrapping value td and locates the input inside it", async () => {
    await surface.open(pageUrl("labeled-fields.html"));
    const control = await surface.locate({
      strategies: [{ type: "relative", text: "LN Acct #" }],
    });
    await expect(control.inputValue()).resolves.toBe("112233");
  });

  it("reads a sibling value cell when a heading repeats the caption", async () => {
    await surface.open(pageUrl("caption-sibling.html"));
    const control = await surface.locate({
      strategies: [{ type: "relative", text: "Hold Confirmation" }],
    });
    await expect(control.innerText()).resolves.toBe("HLD-441122-01-25000");
  });

  it("reads a non-table sibling value cell", async () => {
    await surface.open(pageUrl("caption-sibling.html"));
    const control = await surface.locate({
      strategies: [{ type: "relative", text: "Available After Hold" }],
    });
    await expect(control.innerText()).resolves.toBe("1590.50");
  });

  it("falls back to the next input when the caption has no sibling", async () => {
    await surface.open(pageUrl("caption-sibling.html"));
    const control = await surface.locate({
      strategies: [{ type: "relative", text: "Member #" }],
    });
    await expect(control.inputValue()).resolves.toBe("441122");
  });

  it("uses coordinates only as a last resort", async () => {
    await surface.open(pageUrl("labeled-fields.html"));
    const control = await surface.locate({
      strategies: [
        { type: "roleText", role: "button", text: "Nope" },
        { type: "coordinates", x: 20, y: 20 },
      ],
    });
    await expect(control.innerText()).resolves.toMatch(/CoordTarget/);
  });

  it("fails TARGET_NOT_FOUND when fallbacks also miss", async () => {
    await surface.open(pageUrl("labeled-fields.html"));
    await expect(
      surface.locate({
        strategies: [
          { type: "css", selector: "#does-not-exist" },
          { type: "xpath", selector: "//*[@id='does-not-exist']" },
        ],
      }),
    ).rejects.toMatchObject({ code: "TARGET_NOT_FOUND" });
  });
});

describe("PlaywrightSurface execute", () => {
  const surface = new PlaywrightSurface({ headed: false, timeoutMs: 2_000 });

  afterEach(async () => {
    await surface.close();
  });

  it("fills a labeled field, clicks, and reads the value back", async () => {
    await surface.open(pageUrl("loan-search.html"));
    await surface.execute({
      type: "fill",
      target: { strategies: [{ type: "label", label: "Loan Account" }] },
      value: { literal: "987654" },
    });
    const read = await surface.execute({
      type: "read",
      target: { strategies: [{ type: "label", label: "Loan Account" }] },
    });
    expect(read).toEqual({ status: "ok", details: { value: "987654" } });
    await surface.execute({
      type: "click",
      target: { strategies: [{ type: "roleText", role: "button", text: "Search" }] },
    });
    expect(surface.url()).toMatch(/labeled-fields\.html/);
  });

  it("selects an option by label", async () => {
    await surface.open(pageUrl("loan-search.html"));
    await surface.execute({
      type: "select",
      target: { strategies: [{ type: "label", label: "Account Status" }] },
      value: { literal: "Active" },
    });
    const read = await surface.execute({
      type: "read",
      target: { strategies: [{ type: "label", label: "Account Status" }] },
    });
    expect(read.details).toEqual({ value: "Active" });
  });

  it("fills an unlabeled field via default relative", async () => {
    await surface.open(pageUrl("labeled-fields.html"));
    await surface.execute({
      type: "fill",
      target: { strategies: [{ type: "relative", text: "Amount due" }] },
      value: { literal: "99.00" },
    });
    const read = await surface.execute({
      type: "read",
      target: { strategies: [{ type: "relative", text: "Amount due" }] },
    });
    expect(read).toEqual({ status: "ok", details: { value: "99.00" } });
  });

  it("reads a statement table cell via default relative", async () => {
    await surface.open(pageUrl("labeled-fields.html"));
    const read = await surface.execute({
      type: "read",
      target: { strategies: [{ type: "relative", text: "Statement total" }] },
    });
    expect(read).toEqual({ status: "ok", details: { value: "113544.40" } });
  });

  it("fills an input wrapped in a value td via default relative", async () => {
    await surface.open(pageUrl("labeled-fields.html"));
    await surface.execute({
      type: "fill",
      target: { strategies: [{ type: "relative", text: "LN Acct #" }] },
      value: { literal: "987654" },
    });
    const read = await surface.execute({
      type: "read",
      target: { strategies: [{ type: "relative", text: "LN Acct #" }] },
    });
    expect(read).toEqual({ status: "ok", details: { value: "987654" } });
  });

  it("reads a sibling confirmation id, not the heading with the same text", async () => {
    await surface.open(pageUrl("caption-sibling.html"));
    const read = await surface.execute({
      type: "read",
      target: { strategies: [{ type: "relative", text: "Hold Confirmation" }] },
    });
    expect(read).toEqual({
      status: "ok",
      details: { value: "HLD-441122-01-25000" },
    });
  });

  it("fills a sibling input via default relative", async () => {
    await surface.open(pageUrl("caption-sibling.html"));
    await surface.execute({
      type: "fill",
      target: { strategies: [{ type: "relative", text: "Hold Amt" }] },
      value: { literal: "99.00" },
    });
    const read = await surface.execute({
      type: "read",
      target: { strategies: [{ type: "relative", text: "Hold Amt" }] },
    });
    expect(read).toEqual({ status: "ok", details: { value: "99.00" } });
  });

  it("navigates a relative path", async () => {
    await surface.open(pageUrl("home.html"));
    await surface.execute({ type: "navigate", path: "lending.html" });
    expect(surface.url()).toMatch(/lending\.html$/);
  });
});

describe("PlaywrightSurface assert", () => {
  const surface = new PlaywrightSurface({
    headed: false,
    timeoutMs: 400,
    pollingMs: 50,
  });

  afterEach(async () => {
    await surface.close();
  });

  it("passes textVisible, controlPresent, urlMatches, and state", async () => {
    await surface.open(pageUrl("home.html"));
    expect(
      await surface.assert({ type: "textVisible", value: "Home" }),
    ).toBe(true);
    expect(
      await surface.assert({
        type: "controlPresent",
        target: {
          strategies: [{ type: "roleText", role: "button", text: "Lending" }],
        },
      }),
    ).toBe(true);
    expect(
      await surface.assert({ type: "urlMatches", pattern: "home.html" }),
    ).toBe(true);
    await surface.open(pageUrl("loan-search.html"));
    expect(
      await surface.assert({
        type: "state",
        key: "accountStatus",
        value: "Active",
      }),
    ).toBe(true);
  });

  it("passes valueEquals after a fill", async () => {
    await surface.open(pageUrl("loan-search.html"));
    await surface.execute({
      type: "fill",
      target: { strategies: [{ type: "label", label: "Loan Account" }] },
      value: { literal: "987654" },
    });
    expect(
      await surface.assert({
        type: "valueEquals",
        target: { strategies: [{ type: "label", label: "Loan Account" }] },
        value: { literal: "987654" },
      }),
    ).toBe(true);
  });

  it("returns false when a wait times out", async () => {
    await surface.open(pageUrl("home.html"));
    expect(
      await surface.assert({ type: "textVisible", value: "Never appears" }),
    ).toBe(false);
  });

  it("returns false on a value mismatch", async () => {
    await surface.open(pageUrl("loan-search.html"));
    await surface.execute({
      type: "fill",
      target: { strategies: [{ type: "label", label: "Loan Account" }] },
      value: { literal: "111" },
    });
    expect(
      await surface.assert({
        type: "valueEquals",
        target: { strategies: [{ type: "label", label: "Loan Account" }] },
        value: { literal: "999" },
      }),
    ).toBe(false);
  });
});

describe("PlaywrightSurface observe", () => {
  let screenshotDir: string;
  let surface: PlaywrightSurface;

  afterEach(async () => {
    await surface.close();
    await rm(screenshotDir, { recursive: true, force: true });
  });

  it("writes a screenshot and metadata for a fixture page", async () => {
    screenshotDir = await mkdtemp(join(tmpdir(), "icas-obs-"));
    surface = new PlaywrightSurface({
      headed: false,
      screenshotDir,
    });
    await surface.open(pageUrl("home.html"));
    const observation = await surface.observe();
    expect(observation.url).toMatch(/home\.html$/);
    expect(observation.metadata?.title).toBe("Home");
    expect(observation.imagePath).toBeDefined();
    expect(existsSync(observation.imagePath ?? "")).toBe(true);
    expect(observation.accessibilitySnapshot).toBeDefined();
    expect(String(observation.accessibilitySnapshot)).toMatch(/\[ref=e\d+\]/);
  });

  it("reports document HTTP 404 from a fixture server", async () => {
    const { createServer } = await import("node:http");
    const server = createServer((req, res) => {
      if (req.url === "/missing") {
        res.writeHead(404, { "content-type": "text/html" });
        res.end("<html><body>Not Found</body></html>");
        return;
      }
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<html><body><h1>Home</h1></body></html>");
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    if (address === null || typeof address === "string") {
      server.close();
      throw new Error("expected a TCP address");
    }
    screenshotDir = await mkdtemp(join(tmpdir(), "icas-obs-404-"));
    surface = new PlaywrightSurface({ headed: false, screenshotDir });
    try {
      await surface.open(`http://127.0.0.1:${String(address.port)}/missing`);
      const observation = await surface.observe();
      expect(observation.httpStatus).toBe(404);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error === undefined ? resolve() : reject(error)));
      });
    }
  });

  it("may omit httpStatus or report 200 on a normal page", async () => {
    screenshotDir = await mkdtemp(join(tmpdir(), "icas-obs-200-"));
    surface = new PlaywrightSurface({ headed: false, screenshotDir });
    await surface.open(pageUrl("home.html"));
    const observation = await surface.observe();
    if (observation.httpStatus !== undefined) {
      expect(observation.httpStatus).toBe(200);
    }
  });
});

describe("PlaywrightSurface navigation hooks", () => {
  const surface = new PlaywrightSurface({ headed: false, timeoutMs: 2_000 });

  afterEach(async () => {
    await surface.close();
  });

  it("exposes in-origin vs off-origin destinations before click", async () => {
    await surface.open(pageUrl("home.html"));
    const inOrigin = await surface.peekDestination({
      strategies: [{ type: "roleText", role: "link", text: "Open Lending" }],
    });
    const offOrigin = await surface.peekDestination({
      strategies: [{ type: "roleText", role: "link", text: "External Portal" }],
    });
    expect(inOrigin).toMatch(/lending\.html$/);
    expect(offOrigin).toMatch(/^https:\/\/example\.com\/?$/);
  });

  it("reports destination and resulting URL after an in-origin click", async () => {
    await surface.open(pageUrl("home.html"));
    const result = await surface.execute({
      type: "click",
      target: {
        strategies: [{ type: "roleText", role: "link", text: "Open Lending" }],
      },
    });
    expect(result.status).toBe("ok");
    expect(result.details).toMatchObject({
      destinationUrl: expect.stringMatching(/lending\.html$/),
      resultingUrl: expect.stringMatching(/lending\.html$/),
    });
  });
});

describe("PlaywrightSurface handoff", () => {
  const surface = new PlaywrightSurface({ headed: false, timeoutMs: 2_000 });

  afterEach(async () => {
    await surface.close();
  });

  it("rejects execute while a human owns the session and allows it after resume", async () => {
    await surface.open(pageUrl("loan-search.html"));
    await surface.handoffToHuman();
    expect(surface.controlOwner()).toBe("human");
    await expect(
      surface.execute({
        type: "fill",
        target: { strategies: [{ type: "label", label: "Loan Account" }] },
        value: { literal: "987654" },
      }),
    ).rejects.toMatchObject({
      code: "HUMAN_HAS_CONTROL",
    });
    await surface.resumeFromHuman();
    expect(surface.controlOwner()).toBe("automation");
    const result = await surface.execute({
      type: "fill",
      target: { strategies: [{ type: "label", label: "Loan Account" }] },
      value: { literal: "987654" },
    });
    expect(result.status).toBe("ok");
  });
});
