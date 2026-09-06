# @icas/surface

Surface-independent observation/action abstraction for web now and desktop/accessibility later.

`visibleText()` returns the current view's visible text with no wait so replay can classify `possibleOutcomes` without a locator timeout per phrase. Playwright also appends `input type=submit|button|reset` values, which `innerText` omits. `bindSnapshotRef` / `executeSnapshotRef` are discovery-only; replay uses `locate` / `execute` on catalog targets.
