# @icas/browser

Playwright-backed browser surface implementation.

- `PlaywrightSurface.open(url)` launches Chromium (headed by default; tests pass `{ headed: false }`).
- `execute(action)` maps `click` / `fill` / `select` / `navigate` / `read` onto Playwright. Action values must be literal `ValueRef`s (replay resolves inputs first).
