/**
 * @file Listen for the helix-cu tenant UI on PORT (default 4103).
 */

import { createHelixCuApp } from "./app.js";

const DEFAULT_PORT = 4103;

const port = parsePort(process.env["PORT"]);
const app = createHelixCuApp();

app.listen(port, () => {
  process.stdout.write(
    `helix-cu listening on http://localhost:${String(port)}\n`,
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
