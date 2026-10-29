import { describe, expect, it } from "vitest";
import { synchronizeHumanHost, type HostMember } from "./room-membership.js";

interface TestMember extends HostMember {
  token: string;
}

function member(token: string, overrides: Partial<TestMember> = {}): TestMember {
  return { token, isHost: false, isBot: false, connected: true, ...overrides };
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
