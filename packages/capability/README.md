# @icas/capability

Capability artifacts as data: schema/types, validation, catalog CRUD, tenant overrides, and resolution.

- `validatePrimitiveValue` / `validateInputValues` / `validateOutputValues` — check runtime values against `string` | `number` | `boolean` | `date` | `money`.
- `validateCapabilityOverride(value)` — schema-validate a tenant override. Empty `overrides: {}` is valid. Executable / `customJavaScript` patches are rejected. `baseCapability` must pin `id@version`.

- `FileSystemCapabilityRegistry({ root })` — filesystem backend. Base files at `<root>/<id>/<version>.json`; tenant overrides at `<root>/<id>/overrides/<tenant>.json`. `saveOverride` refuses a pin whose base version is not stored. Tests inject a temp directory.
- `CapabilityResolver` — load base + **enrolled** tenant override, validate, return the effective capability. The effective artifact is never persisted. `icas-play` / MCP fail if the tenant has no override file.

REST/DB registry implementations are out of scope. Callers depend on the interface, not on filesystem paths. See `docs/04-capability-artifact.md`.
