import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  test: {
    // Platform has no unit tests yet; the constitutionally testable bits live
    // in the workspace packages and run via `pnpm -r test` from the workspace root.
    include: ["lib/**/*.test.ts", "lib/**/__tests__/**/*.test.ts"],
    exclude: [
      "node_modules/**",
      "contracts/**",
      "circuits/**",
      "docs/**",
      ".next/**",
      "data/**",
    ],
    passWithNoTests: true,
  },
});
