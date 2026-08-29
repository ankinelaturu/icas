import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { PlaywrightSurface } from "./playwright-surface.js";

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
