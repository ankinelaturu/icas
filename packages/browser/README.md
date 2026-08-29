# @icas/browser

Playwright-backed browser surface implementation.

- `PlaywrightSurface.open(url)` launches Chromium (headed by default; tests pass `{ headed: false }`).
- `locate(target)` tries ranked strategies (`roleText`, `visibleText`, `label`, then `relative` / `css` / `xpath`, with `coordinates` last) and throws `SurfaceError` with code `TARGET_NOT_FOUND` when none match.
