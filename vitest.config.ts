import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: ["**/node_modules/**", "**/dist/**", "**/e2e/**", "**/.{idea,git,cache,output,temp}/**"],
    projects: [
      "packages/*",
      "apps/server",
      "apps/web",
    ],
  },
});
