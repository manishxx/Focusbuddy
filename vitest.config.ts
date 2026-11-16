import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    exclude: ["node_modules/**", "dist/**", "spikes/**", "prototypes/**"],
    testTimeout: 60_000,
    coverage: {
      provider: "v8",
      include: ["src/core/**/*.ts", "src/shell/storage/**/*.ts"],
      exclude: ["src/core/**/*.json"],
      reporter: [["text", { skipFull: false }], "text-summary"],
      // Per file, so one well-tested module cannot hide an untested one.
      thresholds: { lines: 80, perFile: true },
    },
  },
});
