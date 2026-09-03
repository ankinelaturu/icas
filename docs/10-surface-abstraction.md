# 10 — Surface Abstraction

## Purpose

The first implementation is browser-based, but the capability model should not fundamentally mean “Playwright script.” The surface boundary separates semantic capability execution from how a particular UI is observed and manipulated.

## Interface

```ts
interface Surface {
  open(url: string): Promise<void>;
  close(): Promise<void>;
  observe(): Promise<Observation>;
  execute(action: CapabilityAction): Promise<SurfaceActionResult>;
  assert(assertion: Assertion): Promise<boolean>;
  /** Current visible text; no wait. Replay scans this for possibleOutcomes. */
  visibleText(): Promise<string>;
  locate(target: TargetDescriptor): Promise<unknown>;
  peekDestination(target: TargetDescriptor): Promise<string | undefined>;
  handoffToHuman(): Promise<void>;
  resumeFromHuman(): Promise<void>;
}
```

`close` is explicit teardown and must be safe to call twice. `peekDestination` exposes a known navigation URL (anchor href) before click so policy can deny off-origin destinations. `handoffToHuman` / `resumeFromHuman` flip `ControlOwner` on the same session; automation actions are rejected while a human owns control.

## Implemented surface

`PlaywrightSurface` is the first implementation and is responsible for:

- browser lifecycle;
- headed browser session;
- page/full-page observation;
- clicks/fills/selects/navigation;
- target resolution;
- wait/assertion primitives;
- navigation policy hooks;
- browser handoff instrumentation;
- screenshot/DOM evidence capture;
- optional document `httpStatus` on `Observation` when Playwright saw a main-frame document response (omit is valid).

## Visual-first discovery

Discovery may use full rendered page images with a vision-capable model because legacy systems can have poor DOM semantics. Playwright already writes `observation.imagePath` for evidence; `generate` currently embeds that path as text. Attaching pixels is Pass 5.22. The browser driver may supplement the image with accessibility/DOM hints where useful, but the LLM should not depend on clean test IDs.

## Deterministic replay targeting

Replay should prefer stable semantic locators derived during/after discovery rather than raw screen coordinates. TargetDescriptor can contain ranked strategies and fallbacks. `relative` without `xpath`/`role` binds to the nearest following form control, or a table cell that does not wrap one, so inquiry fills skip the wrapping `td` and statement-style caption|value rows can still be `read`.

## Desktop extension

A future desktop implementation could map the same semantic abstractions to:

- accessibility tree / OS automation;
- image/coordinate interaction;
- native control IDs where available.

Example:

```text
Capability action: click semantic target "Payoff"
        ↓
Web: Playwright target resolver
Desktop: accessibility/image target resolver
```

The capability artifact remains the reusable contract while surface-specific resolution changes underneath.
