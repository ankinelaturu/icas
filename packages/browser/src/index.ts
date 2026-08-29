/**
 * @file @icas/browser — Playwright-backed Surface implementation.
 *
 * First Surface backend. Capability artifacts do not encode Playwright
 * locators as the model; targeting stays on {@link TargetDescriptor} ranks.
 */

export {
  PlaywrightSurface,
  type PlaywrightSurfaceOptions,
} from "./playwright-surface.js";
export { SurfaceError } from "./surface-error.js";
