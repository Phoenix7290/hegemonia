import { defineConfig, type Plugin } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { execSync } from "node:child_process";
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

function resolveClientCommitHash(): string {
  if (process.env.GIT_COMMIT_HASH && process.env.GIT_COMMIT_HASH !== "dev") {
    return process.env.GIT_COMMIT_HASH.trim().slice(0, 7);
  }
  try {
    const h = execSync("git rev-parse --short HEAD", {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
    if (h && h.length >= 4) return h.slice(0, 7);
  } catch {}
  try {
    const headPath = resolve(process.cwd(), "../../.git/HEAD");
    const localHeadPath = resolve(process.cwd(), ".git/HEAD");
    const targetPath = existsSync(headPath) ? headPath : (existsSync(localHeadPath) ? localHeadPath : null);
    if (targetPath) {
      const gitDir = resolve(targetPath, "..");
      const head = readFileSync(targetPath, "utf8").trim();
      if (head.startsWith("ref: ")) {
        const refFile = resolve(gitDir, head.slice(5).trim());
        if (existsSync(refFile)) {
          return readFileSync(refFile, "utf8").trim().slice(0, 7);
        }
      } else if (head.length >= 7) {
        return head.slice(0, 7);
      }
    }
  } catch {}
  return "dev";
}

const commitHash = resolveClientCommitHash();

function emitCommitPlugin(): Plugin {
  return {
    name: "emit-commit-file",
    writeBundle(options) {
      const outDir = options.dir || resolve(process.cwd(), "dist");
      try {
        if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
        writeFileSync(resolve(outDir, "commit.txt"), commitHash, "utf8");
      } catch {}
    },
  };
}

export default defineConfig({
  define: {
    __COMMIT_HASH__: JSON.stringify(commitHash),
  },
  plugins: [svelte(), emitCommitPlugin()],
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
