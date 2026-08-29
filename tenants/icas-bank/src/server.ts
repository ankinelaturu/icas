/**
 * @file Listen for the icas-bank tenant UI on PORT (default 4101).
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
