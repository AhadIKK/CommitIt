import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const root = fileURLToPath(new URL(".", import.meta.url));

// Shared backend types live in ../src (imported as @src/*.js).
// TS resolves @src/x.js → ../src/x.ts via paths; this alias does the same
// for Vite's bundler at dev/build time. No extra deps.
export default defineConfig({
  root,
  plugins: [react()],
  resolve: {
    alias: [
      {
        find: /^@src\/(.*)\.js$/,
        replacement: `${path.resolve(root, "../src")}/$1.ts`,
      },
    ],
  },
  build: {
    outDir: path.resolve(root, "../public"),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: { "/api": "http://localhost:3000" },
  },
});
