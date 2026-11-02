import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));

// Map NodeNext-style `.js` relative imports (e.g. `../src/verify.js`)
// to their `.ts` sources so vite-node can resolve them in tests.
// Bare package imports are untouched (pattern only matches ./ and ../).
export default defineConfig({
  // e2e/ holds Playwright specs, run by `npx playwright test`, not vitest.
  // Without this they are collected here and fail on the Playwright import.
  test: {
    exclude: ["e2e/**", "node_modules/**", "dist/**"],
  },
  resolve: {
    alias: [
      { find: /^(\.\.?\/.*)\.js$/, replacement: "$1.ts" },
      { find: /^@src\/(.*)\.js$/, replacement: `${path.resolve(root, "src")}/$1.ts` },
    ],
  },
});
