# @icas/capability

Capability artifacts as data: schema/types, validation, catalog CRUD, tenant overrides, and resolution.

- `validatePrimitiveValue` / `validateInputValues` / `validateOutputValues` — check runtime values against `string` | `number` | `boolean` | `date` | `money`.
- Artifact schema: optional per-step `possibleOutcomes` (`kind`, `match.phrases`, nullable `heading` / `summary`). `heading` is tool/HITL copy, not a locator. `StepOverride` may replace that list.
- `validateCapabilityOverride(value)` — schema-validate a tenant override. Empty `overrides: {}` is valid. Executable / `customJavaScript` patches are rejected. `baseCapability` is the catalog id (no `@version` pin).

- `FileSystemCapabilityRegistry({ root })` — filesystem backend. Base file at `<root>/<id>/capability.json`; tenant overrides at `<root>/<id>/overrides/<tenant>.json`. `saveOverride` refuses when the named base is not stored. Tests inject a temp directory.
- `CapabilityResolver` — load base + enrolled tenant override (header-only or patch), schema-validate, return the effective capability. Never persists the merge. Missing enrollment fails.

REST/DB registry implementations are out of scope. Callers depend on the interface, not on filesystem paths. See `docs/04-capability-artifact.md`.
