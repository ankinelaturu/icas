# System Tests

Top-level tests cover behavior that crosses package boundaries. Small unit tests may live beside individual packages.

- `integration/` — discovery→capability, replay contracts, policy, adaptation, fallback. Run with `pnpm test:integration`.
- `e2e/` — full target-app flows using synthetic tenants.
- `fixtures/` — hand-authored artifacts/observations used only for tests; not submission evidence.
- `fixtures/pages/` — static HTML for surface/locator tests (home, lending, loan-search, labeled fields, loan-not-found). Not a full tenant app.
