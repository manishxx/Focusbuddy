import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    exclude: ["node_modules/**", "dist/**", "spikes/**", "prototypes/**"],
    testTimeout: 60_000,
    coverage: {
      provider: "v8",
      include: ["src/core/**/*.ts"],
      exclude: ["src/core/**/*.json"],
      reporter: [["text", { skipFull: false }], "text-summary"],
      thresholds: { lines: 80 },
    },
  },
});
