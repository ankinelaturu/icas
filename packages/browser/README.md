# @icas/browser

Playwright-backed browser surface implementation.

- `PlaywrightSurface.open(url)` launches Chromium (headed by default; tests pass `{ headed: false }`).
- `peekDestination(target)` returns an absolute URL from an anchor href when known. Click `details` include `destinationUrl` and `resultingUrl`.
