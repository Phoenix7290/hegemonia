import { describe, expect, it } from "vitest";
import {
  advanceDisconnectedTurnTimeout,
  applyConsentedLeaveTransition,
  applyDisconnectTimeoutTransition,
  applyLeaveMatchTransition,
  restoreHumanOnReconnect,
  synchronizeHumanHost,
  type HostMember,
  type TakeoverMember,
} from "./room-membership.js";

interface TestMember extends HostMember {
  token: string;
}

function member(token: string, overrides: Partial<TestMember> = {}): TestMember {
  return { token, isHost: false, isBot: false, connected: true, ...overrides };
}

function takeoverMember(token: string, overrides: Partial<TakeoverMember> = {}): TakeoverMember {
  return {
    token,
    sessionId: `sess-${token}`,
    isHost: false,
    isBot: false,
    connected: true,
    ...overrides,
  };
}

describe("room host succession", () => {
  it("keeps a connected human host unchanged", () => {
    const players = [member("host", { isHost: true }), member("guest")];
    synchronizeHumanHost(players);
    expect(players.map((player) => player.isHost)).toEqual([true, false]);
  });

  it("elects one connected human and skips bots and disconnected players", () => {
    const players = [
      member("former-host", { connected: false }),
      member("bot", { isBot: true }),
      member("offline", { connected: false }),
      member("next-host"),
      member("other-human"),
    ];
    synchronizeHumanHost(players);
    expect(players.find((player) => player.isHost)?.token).toBe("next-host");
    expect(players.filter((player) => player.isHost)).toHaveLength(1);
  });

  it("removes invalid host flags when no human is connected", () => {
    const players = [
      member("former-host", { isHost: true, connected: false }),
      member("bot", { isBot: true }),
    ];
    synchronizeHumanHost(players);
    expect(players.some((player) => player.isHost)).toBe(false);
  });

  it("elects a returning human when the room has no host", () => {
    const players = [member("returning"), member("bot", { isBot: true })];
    synchronizeHumanHost(players);
    expect(players[0].isHost).toBe(true);
  });
});

describe("bot takeover and reconnect resilience (HEGEM-146)", () => {
  it("activates bot immediately when player leaves match with immediate takeover", () => {
    const player = takeoverMember("p1", { isHost: true });
    const immediate = applyLeaveMatchTransition(player, "immediate", true);
    expect(immediate).toBe(true);
    expect(player.isBot).toBe(true);
    expect(player.connected).toBe(false);
    expect(player.isHost).toBe(false);
    expect(player.leftMatchExplicitly).toBe(true);
  });

  it("defers bot takeover for 2 missed turns when player leaves with after_2_turns", () => {
    const player = takeoverMember("p1");
    const immediate = applyLeaveMatchTransition(player, "after_2_turns", true);
    expect(immediate).toBe(false);
    expect(player.isBot).toBe(false);
    expect(player.connected).toBe(false);

    // First missed turn timeout keeps human slot open for reconnect
    expect(advanceDisconnectedTurnTimeout(player)).toBe(false);
    expect(player.isBot).toBe(false);
    expect(player.disconnectedTurns).toBe(1);

    // Second missed turn triggers AI takeover
    expect(advanceDisconnectedTurnTimeout(player)).toBe(true);
    expect(player.isBot).toBe(true);
    expect(player.disconnectedTurns).toBe(2);
  });

  it("activates immediate AI takeover on consented leave without leave_match during active match", () => {
    const player = takeoverMember("p1");
    expect(applyConsentedLeaveTransition(player, true)).toBe(true);
    expect(player.isBot).toBe(true);
    expect(player.connected).toBe(false);

    // Does not override explicit after_2_turns leave_match if onLeave arrives right after
    const deferred = takeoverMember("p2");
    applyLeaveMatchTransition(deferred, "after_2_turns", true);
    expect(applyConsentedLeaveTransition(deferred, true)).toBe(false);
    expect(deferred.isBot).toBe(false);
  });

  it("restores human control when a player reconnects after AI takeover", () => {
    const player = takeoverMember("p1", {
      isBot: true,
      connected: false,
      disconnectedTurns: 2,
      botTakeoverMode: "after_2_turns",
      leftMatchExplicitly: true,
    });
    expect(restoreHumanOnReconnect(player)).toBe(true);
    expect(player.isBot).toBe(false);
    expect(player.connected).toBe(true);
    expect(player.disconnectedTurns).toBe(0);
    expect(player.leftMatchExplicitly).toBe(false);

    // Reconnecting after disconnect timeout preserves after_2_turns until 2 turns expire
    const dropped = takeoverMember("p2");
    expect(applyDisconnectTimeoutTransition(dropped, true)).toBe(false);
    expect(dropped.botTakeoverMode).toBe("after_2_turns");
  });
});
