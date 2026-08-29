/**
 * @file Listen for the loki-bank tenant UI on PORT (default 4102).
 *
 * Process entry only. The request graph lives in {@link createLokiBankApp} so
 * tests can import the handler without binding a port. Default 4102 (icas-bank
 * uses 4101) so both synthetic tenants can run at once.
 */

import { createLokiBankApp } from "./app.js";

const DEFAULT_PORT = 4102;

const port = parsePort(process.env["PORT"]);
const app = createLokiBankApp();

app.listen(port, () => {
  process.stdout.write(
    `loki-bank listening on http://localhost:${String(port)}\n`,
  );
});

/**
 * Parse `PORT`. Invalid values throw rather than silently falling back —
 * a mistyped env must not bind a surprise port next to icas-bank.
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
