# @icas/browser

Playwright-backed browser surface implementation.

- `PlaywrightSurface.open(url)` launches Chromium (headed by default; tests pass `{ headed: false }`).
- `assert(assertion)` waits up to `timeoutMs` (poll `pollingMs` for values). Returns `false` on timeout or mismatch.
