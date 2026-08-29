# @icas/capability

Capability artifacts as data: schema/types, validation, catalog CRUD, tenant overrides, and resolution.

- `validatePrimitiveValue` / `validateInputValues` / `validateOutputValues` — check runtime values against `string` | `number` | `boolean` | `date` | `money`.
- `resolveValueRef(ref, inputs)` — resolve `{ input }` or `{ literal }` (exactly one).

- `CapabilityRegistry` — abstract repository API (list/get/save/remove, including overrides).
- `FileSystemCapabilityRegistry({ root })` — the implemented backend. Production root is repo `capabilities/`; tests pass a temp directory.
- `CapabilityResolver` — load base + **enrolled** tenant override, validate, return the effective capability. The effective artifact is never persisted. `icas-play` / MCP fail if the tenant has no override file.

REST/DB registry implementations are out of scope. Callers depend on the interface, not on filesystem paths. See `docs/04-capability-artifact.md`.
