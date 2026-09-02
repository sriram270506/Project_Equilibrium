import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    // tests/ holds Playwright end-to-end specs, which vitest cannot run.
    // They execute via `npm run test:e2e` against a live server instead.
    exclude: ["node_modules/**", ".next/**", "tests/**"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
    },
  },
});
