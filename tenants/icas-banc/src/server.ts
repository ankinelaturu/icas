/**
 * @file Listen for the icas-banc tenant UI on PORT (default 4104).
 *
 * Process entry only. The request graph lives in {@link createIcasBancApp} so
 * tests can import this handler without binding a port. Default 4104 so it
 * can run beside icas-bank (4101), Loki (4102), and Helix (4103).
 */

import { createIcasBancApp } from "./app.js";

const DEFAULT_PORT = 4104;

const port = parsePort(process.env["PORT"]);
const app = createIcasBancApp();

app.listen(port, () => {
  process.stdout.write(
    `icas-banc listening on http://localhost:${String(port)}\n`,
  );
});

/**
 * Parse `PORT`. Invalid values throw rather than silently falling back —
 * a mistyped env must not bind a surprise port next to the other tenants.
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
