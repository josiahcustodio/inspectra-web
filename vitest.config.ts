import path from "path";
import { defineConfig } from "vitest/config";

// Unit tests for the pure logic under src/lib. Deliberately NOT the Vite app
// config: the React and Tailwind plugins have no business in a logic test run.
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
