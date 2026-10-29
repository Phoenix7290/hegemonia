import { describe, expect, it, vi } from "vitest";
import {
  HEGEMONIA_ROOM_NAME,
  InvalidRoomCodeError,
  connectToRoom,
  isRecoverableConnectionError,
  isRoomNotFoundError,
  normalizeRoomCode,
  reconnectDelay,
  resolveWebSocketUrl,
  retryWithBackoff,
  type RoomClient,
} from "./multiplayer.js";

function clientMock() {
  return {
    create: vi.fn(),
    joinById: vi.fn(),
  } as unknown as RoomClient & { create: ReturnType<typeof vi.fn>; joinById: ReturnType<typeof vi.fn> };
}

describe("room code and endpoint resolution", () => {
  it("normalizes valid hexadecimal room codes", () => {
    expect(normalizeRoomCode(" a1b2c3 ")).toBe("A1B2C3");
  });

  it.each(["", "ABC", "G1B2C3", "A1B2C3-extra"])("rejects invalid code %s", (code) => {
    expect(() => normalizeRoomCode(code)).toThrow(InvalidRoomCodeError);
  });

  it("uses the development game port on the current hostname", () => {
    expect(resolveWebSocketUrl({ protocol: "http:", hostname: "play.example", host: "play.example:5173", port: "5173" }))
      .toBe("ws://play.example:2567");
  });

  it("keeps same-origin deployment and upgrades HTTPS to WSS", () => {
    const location = { protocol: "https:", hostname: "play.example", host: "play.example", port: "" };
    expect(resolveWebSocketUrl(location)).toBe("wss://play.example");
    expect(resolveWebSocketUrl(location, "wss://internal.example/game")).toBe("wss://internal.example/game");
  });
});

describe("explicit room matchmaking", () => {
  it("creates only through the explicit create operation", async () => {
    const client = clientMock();
    client.create.mockResolvedValue({ roomId: "A1B2C3" });
    await expect(connectToRoom(client, { create: true, name: "Alice", token: "token-a" }))
      .resolves.toEqual({ roomId: "A1B2C3" });
    expect(client.create).toHaveBeenCalledWith(HEGEMONIA_ROOM_NAME, { name: "Alice", token: "token-a" });
    expect(client.joinById).not.toHaveBeenCalled();
  });

  it("joins an existing room by id without creating a replacement", async () => {
    const client = clientMock();
    client.joinById.mockResolvedValue({ roomId: "A1B2C3" });
    await connectToRoom(client, { create: false, roomCode: "a1b2c3", name: "Bob", token: "token-b" });
    expect(client.joinById).toHaveBeenCalledWith("A1B2C3", { name: "Bob", token: "token-b" });
    expect(client.create).not.toHaveBeenCalled();
  });

  it("does not call matchmaking for an invalid code", async () => {
    const client = clientMock();
    await expect(connectToRoom(client, { create: false, roomCode: "bad", name: "Bob", token: "token-b" }))
      .rejects.toBeInstanceOf(InvalidRoomCodeError);
    expect(client.joinById).not.toHaveBeenCalled();
  });
});

describe("reconnection policy", () => {
  it("retries transient failures with capped exponential delays", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const onAttempt = vi.fn();
    const operation = vi.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue("connected");

    await expect(retryWithBackoff(operation, { sleep, onAttempt })).resolves.toBe("connected");
    expect(operation).toHaveBeenCalledTimes(3);
    expect(onAttempt.mock.calls).toEqual([[1, 8], [2, 8], [3, 8]]);
    expect(sleep.mock.calls).toEqual([[500], [1000]]);
    expect(reconnectDelay(4)).toBe(4000);
    expect(reconnectDelay(8)).toBe(5000);
  });

  it("stops immediately when the room no longer exists", async () => {
    const error = Object.assign(new Error("not found"), { code: 4212 });
    const operation = vi.fn().mockRejectedValue(error);
    const sleep = vi.fn();
    await expect(retryWithBackoff(operation, { sleep })).rejects.toBe(error);
    expect(operation).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(isRoomNotFoundError(error)).toBe(true);
    expect(isRecoverableConnectionError(error)).toBe(false);
  });

  it("stops after the configured attempt limit", async () => {
    const operation = vi.fn().mockRejectedValue(new Error("offline"));
    const sleep = vi.fn().mockResolvedValue(undefined);
    await expect(retryWithBackoff(operation, { maxAttempts: 3, sleep })).rejects.toThrow("offline");
    expect(operation).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[500], [1000]]);
  });
});
