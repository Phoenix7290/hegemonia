import { beforeEach, describe, expect, it, vi } from "vitest";
import { HEGEMONIA_VERSION } from "@hegemonia/shared";
import { VersionGuardState } from "./version.svelte";

describe("VersionGuardState", () => {
  let guard: VersionGuardState;

  beforeEach(() => {
    vi.useFakeTimers();
    sessionStorage.clear();
    guard = new VersionGuardState();
  });

  it("initializes with current client version and clean state", () => {
    expect(guard.clientVersion).toBe(HEGEMONIA_VERSION);
    expect(guard.serverVersion).toBeNull();
    expect(guard.isOutdated).toBe(false);
    expect(guard.dismissed).toBe(false);
    expect(guard.countdown).toBeNull();
  });

  it("ignores matching server version", () => {
    guard.checkServerVersion(HEGEMONIA_VERSION, false);
    expect(guard.isOutdated).toBe(false);
    expect(guard.serverVersion).toBeNull();
    expect(guard.countdown).toBeNull();
  });

  it("detects outdated version in active battle without auto-reload countdown", () => {
    guard.checkServerVersion("0.6.0", true);
    expect(guard.isOutdated).toBe(true);
    expect(guard.serverVersion).toBe("0.6.0");
    expect(guard.countdown).toBeNull();
  });

  it("starts auto-reload countdown when outdated in lobby / out of battle", () => {
    guard.checkServerVersion("0.6.0", false);
    expect(guard.isOutdated).toBe(true);
    expect(guard.serverVersion).toBe("0.6.0");
    expect(guard.countdown).toBe(5);

    vi.advanceTimersByTime(1000);
    expect(guard.countdown).toBe(4);

    guard.cancelCountdown();
    expect(guard.countdown).toBeNull();
  });

  it("dismiss clears countdown and sets dismissed flag", () => {
    guard.checkServerVersion("0.6.0", false);
    expect(guard.countdown).toBe(5);

    guard.dismiss();
    expect(guard.dismissed).toBe(true);
    expect(guard.countdown).toBeNull();
  });
});
