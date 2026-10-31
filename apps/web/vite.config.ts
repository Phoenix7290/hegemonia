import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

export default defineConfig({
  plugins: [svelte()],
  server: {
    host: "::",
    port: 5173,
  },
  test: {
    exclude: ["e2e/**", "node_modules/**", "dist/**"],
  },
} as any);
