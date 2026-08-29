# @icas/browser

Playwright-backed browser surface implementation.

- `PlaywrightSurface.open(url)` launches Chromium (headed by default; tests pass `{ headed: false }`).
- `handoffToHuman` / `resumeFromHuman` transfer control of the **same** session. Execute/locate/assert throw `HUMAN_HAS_CONTROL` while a human owns it. Observe stays available for evidence.
