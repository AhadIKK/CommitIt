import { defineConfig } from "vitest/config";

// Map NodeNext-style `.js` relative imports (e.g. `../src/verify.js`)
// to their `.ts` sources so vite-node can resolve them in tests.
// Bare package imports are untouched (pattern only matches ./ and ../).
export default defineConfig({
  resolve: {
    alias: [{ find: /^(\.\.?\/.*)\.js$/, replacement: "$1.ts" }],
  },
});
