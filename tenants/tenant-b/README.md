# Tenant B — Placeholder

This directory is intentionally left as a placeholder. The tenant application will be generated independently.

Planned role:

- synthetic bank/credit-union back-office application;
- same fictional **Vendor + Product** as `tenants/icas-bank` (`icas-bank` / `icas-bank`);
- catalog tenant id `tenant-b` (`icas-adapt --tenant tenant-b`);
- small but meaningful tenant-specific customization;
- enough variation to test guarded replay, assisted fallback, and `icas-adapt`;
- deterministic fixture data;
- no real credentials or PII.

Tenant B should not be a completely unrelated banking app. It exists to model another institution running the same underlying vendor product with configuration/UI drift.
