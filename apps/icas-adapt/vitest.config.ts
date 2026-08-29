/**
 * @file Vitest config for @icas/adapt CLI tests.
 */

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
