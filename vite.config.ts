import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import packageJson from "./package.json" with { type: "json" };

export default defineConfig({
  base: process.env.NODE_ENV === "production" ? "/bluehour/" : "/",
  plugins: [react()],
  define: {
    __BLUEHOUR_VERSION__: JSON.stringify(packageJson.version)
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./src/test/setup.ts",
    exclude: ["node_modules", "dist", "e2e", "playwright-report", "test-results"],
    coverage: {
      provider: "v8"
    }
  }
});
