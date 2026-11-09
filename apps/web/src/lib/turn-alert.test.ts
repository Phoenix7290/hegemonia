import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, beforeEach } from "vitest";
import { ui } from "./ui.svelte";

describe("HEGEM-95: HUD & Feedback Turn Timeout Alert (Last 10 Seconds)", () => {
  const store = new Map<string, string>();

  beforeEach(() => {
    store.clear();
    (globalThis as any).localStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, val: string) => store.set(key, String(val)),
      removeItem: (key: string) => store.delete(key),
      clear: () => store.clear(),
    };
  });

  describe("Options & Accessibility State", () => {
    it("initializes turnTimerAlertsEnabled to true by default", () => {
      ui.setTurnTimerAlerts(true);
      expect(ui.turnTimerAlertsEnabled).toBe(true);
    });

    it("toggles and persists turnTimerAlertsEnabled in localStorage", () => {
      ui.setTurnTimerAlerts(true);
      ui.toggleTurnTimerAlerts();
      expect(ui.turnTimerAlertsEnabled).toBe(false);
      expect(localStorage.getItem("hegemonia_turn_timer_alerts_enabled")).toBe("false");

      ui.toggleTurnTimerAlerts();
      expect(ui.turnTimerAlertsEnabled).toBe(true);
      expect(localStorage.getItem("hegemonia_turn_timer_alerts_enabled")).toBe("true");
    });
  });

  describe("TopBar Visual Timer Alert (< 10s)", () => {
    const topBarPath = resolve(__dirname, "../components/TopBar.svelte");
    const code = readFileSync(topBarPath, "utf-8");

    it("implements timer-critical and timer-pulse-glow when remainingSeconds <= 10", () => {
      expect(code).toContain("timer-critical={remainingSeconds <= 10}");
      expect(code).toContain("timer-danger={remainingSeconds <= 20 && remainingSeconds > 10}");
      expect(code).toContain(".tc-timer.timer-critical");
      expect(code).toContain("animation: timer-pulse-glow 1s ease-in-out infinite alternate");
    });

    it("includes accessible ARIA attributes and labels for screen readers", () => {
      expect(code).toContain('role="timer"');
      expect(code).toContain('aria-live={remainingSeconds <= 10 ? "assertive" : "off"}');
      expect(code).toMatch(/aria-label=\{`Tempo restante de turno:\s*\$\{remainingSeconds\}\s*segundos`\}/);
    });

    it("respects prefers-reduced-motion for the pulsing glow", () => {
      expect(code).toContain("@media (prefers-reduced-motion: reduce)");
      expect(code).toContain("animation: none;");
    });

    it("renders options menu toggle for turn timeout alerts", () => {
      expect(code).toContain("Alertas de Fim de Turno:");
      expect(code).toContain("ui.turnTimerAlertsEnabled");
      expect(code).toContain("ui.toggleTurnTimerAlerts()");
    });
  });

  describe("ActionConsole Prominent Countdown Badge", () => {
    const consolePath = resolve(__dirname, "../components/ActionConsole.svelte");
    const code = readFileSync(consolePath, "utf-8");

    it("accepts remainingSeconds as a prop", () => {
      expect(code).toContain("remainingSeconds?: number;");
      expect(code).toContain("remainingSeconds,");
    });

    it("renders prominent turn-timeout-badge when isMyTurn and remainingSeconds <= 10", () => {
      expect(code).toContain('class="turn-timeout-badge"');
      expect(code).toContain("danger-flash={remainingSeconds <= 5}");
      expect(code).toContain('role="alert"');
      expect(code).toContain('aria-live="assertive"');
      expect(code).toContain("FIM DE TURNO IMINENTE");
      expect(code).toContain("{remainingSeconds}s");
    });

    it("defines high-urgency flashing styles for the final 5 seconds", () => {
      expect(code).toContain(".turn-timeout-badge.danger-flash");
      expect(code).toContain("animation: badge-pulse-urgent 0.5s ease-in-out infinite alternate;");
      expect(code).toContain("@media (prefers-reduced-motion: reduce)");
    });
  });

  describe("App Fullscreen Screen-Edge Vignette and Sound Cue Loop", () => {
    const appPath = resolve(__dirname, "../App.svelte");
    const code = readFileSync(appPath, "utf-8");

    it("renders turn-critical-vignette when player is active and remainingSeconds <= 10", () => {
      expect(code).toContain('class="turn-critical-vignette"');
      expect(code).toContain("isMyTurn && !game.winnerId && remainingSeconds <= 10 && ui.turnTimerAlertsEnabled");
      expect(code).toContain("extreme-urgency={remainingSeconds <= 3}");
    });

    it("triggers sound.playTurnTimerTick(remainingSeconds) exactly once per second in final 5s", () => {
      expect(code).toContain("remainingSeconds <= 5 &&");
      expect(code).toContain("sound.playTurnTimerTick(remainingSeconds);");
      expect(code).toContain("lastTimerTickSecond !== remainingSeconds");
    });

    it("passes remainingSeconds down to ActionConsole", () => {
      expect(code).toMatch(/<ActionConsole[\s\S]*?\{remainingSeconds\}/);
    });

    it("defines inset vignette box-shadow with pointer-events: none", () => {
      expect(code).toContain(".turn-critical-vignette {");
      expect(code).toContain("pointer-events: none;");
      expect(code).toContain("inset: 0;");
      expect(code).toContain("box-shadow: inset 0 0 55px rgba(239, 68, 68, 0.28)");
    });
  });
});
