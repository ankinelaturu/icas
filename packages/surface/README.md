# @icas/surface

Surface-independent observation/action abstraction for web now and desktop/accessibility later.

`close()` tears down the session and is safe to call twice. `resumeFromHuman()` returns control after `handoffToHuman()`. `Observation.httpStatus` is optional document status when the driver observed it. `visibleText()` returns the current view's visible text with no wait so replay can classify `possibleOutcomes` without a locator timeout per phrase. `bindSnapshotRef` / `executeSnapshotRef` are discovery-only; replay uses `locate` / `execute` on catalog targets.
