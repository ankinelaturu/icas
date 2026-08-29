import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { PlaywrightSurface } from "./playwright-surface.js";
import { SurfaceError } from "./surface-error.js";

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
});

describe("PlaywrightSurface locate (semantic)", () => {
  const surface = new PlaywrightSurface({ headed: false, timeoutMs: 400 });

  afterEach(async () => {
    await surface.close();
  });

  it("finds a button by role and text", async () => {
    await surface.open(pageUrl("home.html"));
    const control = await surface.locate({
      strategies: [{ type: "roleText", role: "button", text: "Lending" }],
    });
    await expect(control.innerText()).resolves.toBe("Lending");
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
