import { describe, expect, it } from "vitest";
import { HEGEMONIA_VERSION, MATCHMAKING_RULESET_VERSION } from "@hegemonia/shared";

const hasDatabase = Boolean(process.env.TEST_DATABASE_URL || process.env.DATABASE_URL);

describe("version handshake and cache busting API", () => {
  it("exports valid semantic version", () => {
    expect(HEGEMONIA_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(MATCHMAKING_RULESET_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it.skipIf(!hasDatabase)("serves /api/version with no-cache headers and current version payload", async () => {
    if (!process.env.DATABASE_URL && process.env.TEST_DATABASE_URL) {
      process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    }
    const { createApp } = await import("./app.js");
    const app = await createApp();
    const server = app.listen(0);
    const address = server.address();
    if (!address || typeof address === "string") {
      server.close();
      throw new Error("Failed to get port from listening server");
    }

    try {
      const res = await fetch(`http://127.0.0.1:${address.port}/api/version`);
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toContain("no-cache");
      expect(res.headers.get("cache-control")).toContain("no-store");
      expect(res.headers.get("cache-control")).toContain("must-revalidate");

      const body = (await res.json()) as { version: string; rulesetVersion: string; commitHash: string };
      expect(body.version).toBe(HEGEMONIA_VERSION);
      expect(body.rulesetVersion).toBe(MATCHMAKING_RULESET_VERSION);
      expect(body.commitHash).toBeDefined();
      expect(typeof body.commitHash).toBe("string");
    } finally {
      server.close();
    }
  });
});
