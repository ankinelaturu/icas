# @icas/capability

Capability artifacts as data: schema/types, validation, catalog CRUD, tenant overrides, and resolution.

- `validateCapabilityArtifact(value)` — schema-validate unknown JSON. Throws `CapabilityValidationError` with a readable path and message. `schemaVersion` is the format (`"1.0"`); `capabilityVersion` is the flow semver (`"1.0.0"`).

- `CapabilityRegistry` — abstract repository API (list/get/save/remove, including overrides).
- `FileSystemCapabilityRegistry({ root })` — the implemented backend. Production root is repo `capabilities/`; tests pass a temp directory.
- `CapabilityResolver` — load base + **enrolled** tenant override, validate, return the effective capability. The effective artifact is never persisted. `icas-play` / MCP fail if the tenant has no override file.

REST/DB registry implementations are out of scope. Callers depend on the interface, not on filesystem paths. See `docs/04-capability-artifact.md`.
