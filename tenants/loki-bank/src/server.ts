/**
 * @file Listen for the loki-bank tenant UI on PORT (default 4102).
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
