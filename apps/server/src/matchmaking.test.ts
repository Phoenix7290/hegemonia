import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MatchmakingError,
  MatchmakingService,
  rankedRatingRange,
  type MatchedRoomOptions,
} from "./matchmaking.js";
import type { MatchmakingSeason } from "@hegemonia/shared";

vi.mock("./connection.js", () => ({ query: vi.fn() }));

const season: MatchmakingSeason = { id: "season-1", slug: "season-1", name: "Temporada 1" };
const services: MatchmakingService[] = [];

function createHarness(options: {
  ratings?: Record<string, number>;
  activeMatches?: Set<string>;
  createRoom?: (options: MatchedRoomOptions) => Promise<{ roomId: string }>;
} = {}) {
  let now = 0;
  const createRoom = vi.fn(options.createRoom ?? (async () => ({ roomId: "ABC123" })));
  const service = new MatchmakingService({
    now: () => now,
    createRoom,
    hasActiveMatch: async (userId) => options.activeMatches?.has(userId) ?? false,
    getRankedContext: async (userId) => ({
      rating: options.ratings?.[userId] ?? 1_000,
      season,
    }),
  });
  services.push(service);
  return {
    service,
    createRoom,
    advance(milliseconds: number) { now += milliseconds; },
  };
}

afterEach(() => {
  while (services.length) services.pop()?.dispose();
  vi.restoreAllMocks();
});

describe("MatchmakingService", () => {
  it("rejeita fila duplicada, partida ativa e versão incompatível", async () => {
    const { service } = createHarness({ activeMatches: new Set(["busy"]) });
    await service.enqueue("alice", { mode: "casual" });
    await expect(service.enqueue("alice", { mode: "casual" })).rejects.toMatchObject({
      code: "already_queued",
      status: 409,
    });
    await expect(service.enqueue("busy", { mode: "ranked" })).rejects.toMatchObject({
      code: "active_match",
    });
    await expect(service.enqueue("bob", {
      mode: "casual",
      rulesetVersion: "old",
    })).rejects.toMatchObject({ code: "version_incompatible" });
  });

  it("cria uma única sala para dois jogadores sob chamadas concorrentes", async () => {
    const { service, createRoom } = createHarness();
    const [alice, bob] = await Promise.all([
      service.enqueue("alice", { mode: "casual" }),
      service.enqueue("bob", { mode: "casual" }),
    ]);

    expect(createRoom).toHaveBeenCalledTimes(1);
    expect(alice.status).toBe("queued");
    expect(bob).toMatchObject({ status: "matched", roomCode: "ABC123" });
    expect(await service.getStatus("alice")).toMatchObject({
      status: "matched",
      roomCode: "ABC123",
      mode: "casual",
    });
    expect(createRoom.mock.calls[0][0]).toMatchObject({
      competitionMode: "casual",
      matchOrigin: "matchmaking",
    });
    expect(new Set(createRoom.mock.calls[0][0].expectedUserIds)).toEqual(new Set(["alice", "bob"]));
    await expect(service.cancel("alice")).rejects.toMatchObject({ code: "match_already_found" });
  });

  it("devolve os tickets à fila quando a criação da sala falha", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const createRoom = vi.fn()
      .mockRejectedValueOnce(new Error("indisponível"))
      .mockResolvedValueOnce({ roomId: "RETRY1" });
    const { service } = createHarness({ createRoom });

    await service.enqueue("alice", { mode: "casual" });
    await service.enqueue("bob", { mode: "casual" });
    expect(await service.getStatus("alice")).toMatchObject({ status: "matched", roomCode: "RETRY1" });
    expect(await service.getStatus("bob")).toMatchObject({ status: "matched", roomCode: "RETRY1" });
    expect(createRoom).toHaveBeenCalledTimes(2);
  });

  it("cancela buscas, remove tickets no logout e expira clientes sem heartbeat", async () => {
    const { service, advance } = createHarness();
    await service.enqueue("alice", { mode: "casual" });
    expect(await service.cancel("alice")).toMatchObject({ status: "idle" });

    await service.enqueue("bob", { mode: "casual" });
    await service.logout("bob");
    expect(await service.getStatus("bob")).toMatchObject({ status: "idle" });

    await service.enqueue("carol", { mode: "casual" });
    advance(30_000);
    expect(await service.getStatus("carol")).toMatchObject({ status: "idle" });
  });

  it("expira reservas não confirmadas", async () => {
    const { service, advance } = createHarness();
    await service.enqueue("alice", { mode: "casual" });
    await service.enqueue("bob", { mode: "casual" });
    advance(120_000);
    expect(await service.getStatus("alice")).toMatchObject({ status: "idle" });
    expect(await service.getStatus("bob")).toMatchObject({ status: "idle" });
  });

  it("amplia gradualmente o rating e respeita temporada e região na Ranqueada", async () => {
    const { service, createRoom, advance } = createHarness({
      ratings: { alice: 1_000, bob: 1_500 },
    });
    await service.enqueue("alice", { mode: "ranked", region: "sa" });
    await service.enqueue("bob", { mode: "ranked", region: "sa" });
    expect(createRoom).not.toHaveBeenCalled();

    for (let step = 0; step < 3; step++) {
      advance(15_000);
      await service.getStatus("alice");
      await service.getStatus("bob");
    }
    expect(createRoom).not.toHaveBeenCalled();
    advance(15_000);
    expect((await service.getStatus("alice")).status).toBe("matched");
    expect(createRoom).toHaveBeenCalledTimes(1);
    expect(createRoom.mock.calls[0][0].seasonId).toBe(season.id);

    await service.enqueue("carol", { mode: "ranked", region: "eu" });
    await service.enqueue("dave", { mode: "ranked", region: "na" });
    advance(15_000);
    expect((await service.getStatus("carol")).status).toBe("queued");
    expect((await service.getStatus("dave")).status).toBe("queued");
  });

  it("não mistura temporadas nem versões de regras", async () => {
    let contextSeason = season;
    let now = 0;
    const createRoom = vi.fn(async () => ({ roomId: "SEASON" }));
    const service = new MatchmakingService({
      now: () => now,
      createRoom,
      hasActiveMatch: async () => false,
      getRankedContext: async () => ({ rating: 1_000, season: contextSeason }),
    });
    services.push(service);
    await service.enqueue("alice", { mode: "ranked" });
    contextSeason = { ...season, id: "season-2" };
    await service.enqueue("bob", { mode: "ranked" });
    now = 15_000;
    expect((await service.getStatus("alice")).status).toBe("queued");
    expect(createRoom).not.toHaveBeenCalled();
  });

  it("confirma participação e reconexão sem duplicar ou bloquear após a saída", async () => {
    const { service } = createHarness();
    await service.enqueue("alice", { mode: "casual" });
    await service.enqueue("bob", { mode: "casual" });

    service.confirmParticipant("alice", "ABC123");
    service.confirmParticipant("alice", "ABC123");
    expect(await service.getStatus("alice")).toMatchObject({ status: "idle" });
    expect(() => service.confirmParticipant("alice", "OTHER1")).toThrow(MatchmakingError);

    service.releaseParticipant("alice", "OTHER1");
    await expect(service.enqueue("alice", { mode: "casual" })).rejects.toMatchObject({
      code: "active_match",
    });
    service.releaseParticipant("alice", "ABC123");
    expect(await service.enqueue("alice", { mode: "casual" })).toMatchObject({ status: "queued" });
  });

  it("limita a ampliação de rating a mil pontos", () => {
    expect(rankedRatingRange(0)).toBe(100);
    expect(rankedRatingRange(15_000)).toBe(200);
    expect(rankedRatingRange(600_000)).toBe(1_000);
  });
});
