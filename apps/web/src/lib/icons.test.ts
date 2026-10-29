import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ICON_CATALOG,
  ICON_NAMES,
  isKnownIconName,
  resolveIconShapes,
  type IconName,
} from "./icons";

function collectSourceFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(fullPath));
    } else if (entry.name.endsWith(".svelte") || entry.name.endsWith(".ts")) {
      files.push(fullPath);
    }
  }
  return files;
}

describe("Hegemonia Icon Design System (HEGEM-63)", () => {
  it("defines non-empty valid 24x24 vector shapes for every registered IconName", () => {
    expect(ICON_NAMES.length).toBeGreaterThanOrEqual(45);
    for (const name of ICON_NAMES) {
      expect(isKnownIconName(name)).toBe(true);
      const shapes = resolveIconShapes(name);
      expect(shapes.length, `Icon "${name}" must have at least 1 shape`).toBeGreaterThan(0);
      for (const shape of shapes) {
        expect(["path", "circle", "rect", "line", "polyline", "polygon"]).toContain(shape.tag);
      }
    }
  });

  it("throws an explicit error in development when an unknown icon name is requested", () => {
    expect(isKnownIconName("non-existent-icon")).toBe(false);
    expect(() => resolveIconShapes("non-existent-icon" as IconName)).toThrow(
      /Unknown icon name/
    );
  });

  it("provides semantically distinct silhouettes for Economic Resources (Money, Gold, Steel, Oil)", () => {
    const moneyJson = JSON.stringify(ICON_CATALOG.coins);
    const goldJson = JSON.stringify(ICON_CATALOG.gold);
    const steelJson = JSON.stringify(ICON_CATALOG.steel);
    const oilJson = JSON.stringify(ICON_CATALOG.oil);

    expect(moneyJson).not.toEqual(goldJson);
    expect(goldJson).not.toEqual(steelJson);
    expect(steelJson).not.toEqual(oilJson);
  });

  it("provides semantically distinct silhouettes for Turn Phases (Deploy, Attack, Maneuver)", () => {
    const deployJson = JSON.stringify(ICON_CATALOG["phase-deploy"]);
    const attackJson = JSON.stringify(ICON_CATALOG["phase-attack"]);
    const maneuverJson = JSON.stringify(ICON_CATALOG["phase-maneuver"]);

    expect(deployJson).not.toEqual(attackJson);
    expect(attackJson).not.toEqual(maneuverJson);
    expect(deployJson).not.toEqual(maneuverJson);
  });

  it("verifies all static <Icon name=\"...\" /> usages in Svelte components reference registered icons", () => {
    const srcRoot = join(__dirname, "..");
    const svelteFiles = collectSourceFiles(srcRoot).filter((f) => f.endsWith(".svelte"));
    const staticNameRegex = /<Icon\s+[^>]*?\bname="([^"{]+)"/g;

    let checkedCount = 0;
    for (const file of svelteFiles) {
      const content = readFileSync(file, "utf-8");
      for (const match of content.matchAll(staticNameRegex)) {
        const iconName = match[1];
        checkedCount++;
        expect(
          isKnownIconName(iconName),
          `Unknown icon "${iconName}" found in ${file}`
        ).toBe(true);
      }
    }
    expect(checkedCount).toBeGreaterThan(30);
  });

  it("enforces Zero Emojis and zero improvised text glyphs across all web UI components and locales", () => {
    const srcRoot = join(__dirname, "..");
    const files = collectSourceFiles(srcRoot).filter((f) => !f.endsWith(".test.ts"));
    const forbiddenGlyphRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}▲▼✕›‹→←]/u;

    for (const file of files) {
      const content = readFileSync(file, "utf-8");
      const match = content.match(forbiddenGlyphRegex);
      expect(
        match,
        `Forbidden emoji or improvised glyph "${match?.[0]}" found in ${file}`
      ).toBeNull();
    }
  });
});
