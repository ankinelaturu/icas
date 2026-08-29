# @icas/browser

Playwright-backed browser surface implementation.

- `PlaywrightSurface.open(url)` launches Chromium (headed by default; tests pass `{ headed: false }`).
- `observe()` writes a full-page PNG under `screenshotDir` (temp dir by default) and attaches URL, title, and an accessibility snapshot.
