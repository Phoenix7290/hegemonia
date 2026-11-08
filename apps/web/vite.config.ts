import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { execSync } from "node:child_process";

let commitHash = "dev";
try {
  commitHash = execSync("git rev-parse --short HEAD", {
    stdio: ["ignore", "pipe", "ignore"],
  })
    .toString()
    .trim();
} catch {
  // Fallback caso git não esteja disponível em tempo de build
}

export default defineConfig({
  define: {
    __COMMIT_HASH__: JSON.stringify(commitHash),
  },
  plugins: [svelte()],
  server: {
    host: "::",
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:2567",
        changeOrigin: true,
      },
    },
  },
  test: {
    exclude: ["e2e/**", "node_modules/**", "dist/**"],
  },
} as any);
