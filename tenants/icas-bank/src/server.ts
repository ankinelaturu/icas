/**
 * @file Listen for the icas-bank tenant UI on PORT (default 4101).
 *
 * Process entry only. The request graph lives in {@link createIcasBankApp} so
 * tests can import the handler without binding a port. Default 4101 (Loki
 * Bank uses 4102) so both synthetic tenants can run at once.
 */

import { createIcasBankApp } from "./app.js";

const DEFAULT_PORT = 4101;

const port = parsePort(process.env["PORT"]);
const app = createIcasBankApp();

app.listen(port, () => {
  process.stdout.write(
    `icas-bank listening on http://localhost:${String(port)}\n`,
  );
});

/**
 * Parse `PORT`. Invalid values throw rather than silently falling back —
 * a mistyped env must not bind a surprise port next to Loki Bank.
 */
function parsePort(raw: string | undefined): number {
  if (raw === undefined || raw.length === 0) {
    return DEFAULT_PORT;
  }
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT: ${raw}`);
  }
  return port;
}
