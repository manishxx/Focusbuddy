import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    exclude: ["node_modules/**", "dist/**", "spikes/**", "prototypes/**"],
    testTimeout: 60_000,
    coverage: {
      provider: "v8",
      // src/shell/adapters/chrome.ts (thin chrome wrappers) and src/shell/sw.ts (wiring) are
      // covered by the e2e tests only.
      include: [
        "src/core/**/*.ts",
        "src/core/parser/**/*.ts",
        "src/shell/storage/**/*.ts",
        "src/shell/engine/**/*.ts",
        "src/shell/messaging/**/*.ts",
        "src/shell/adapters/chromeVersion.ts",
        "src/shell/boot.ts",
      ],
      exclude: ["src/core/**/*.json"],
      reporter: [["text", { skipFull: false }], "text-summary"],
      // Per file, so one well-tested module cannot hide an untested one.
      thresholds: { lines: 80, perFile: true },
    },
  },
});
