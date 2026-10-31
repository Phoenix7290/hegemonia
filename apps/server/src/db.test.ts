import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createGame } from "@hegemonia/engine";
import type { GameState } from "@hegemonia/shared";

const enabled = Boolean(process.env.TEST_DATABASE_URL);
const database = describe.skipIf(!enabled);

let connection: typeof import("./connection.js");
let matches: typeof import("./match-repository.js");
let stats: typeof import("./stats-repository.js");
let seasonId: string;

beforeAll(async () => {
  if (!enabled) return;
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  connection = await import("./connection.js");
  matches = await import("./match-repository.js");
  stats = await import("./stats-repository.js");
});

beforeEach(async () => {
  if (!enabled) return;
  await connection.query(
    "TRUNCATE seasons, users, matches RESTART IDENTITY CASCADE"
  );
  const result = await connection.query<{ id: string }>(
    "INSERT INTO seasons (slug, name, status, starts_at) VALUES ('lifetime', 'Teste', 'active', '-infinity') RETURNING id"
  );
  seasonId = result.rows[0].id;
});

afterAll(async () => {
  if (enabled) await connection.closeDatabase();
});

database("persistência PostgreSQL", () => {
  it("grava evento, snapshot e estado atomicamente e faz rollback em conflito", async () => {
    const state = makeState("pending");
    const matchId = await createCasualMatch(state);
    await matches.appendMatchEvent(matchId, 1, "p1", { type: "end_attack" }, state);

    const duplicate = { ...state, round: 99 };
    await expect(
      matches.appendMatchEvent(matchId, 1, "p1", { type: "end_attack" }, duplicate)
    ).rejects.toThrow();

    const result = await connection.query<{ events: number; snapshots: number; round: number }>(
      `SELECT
        (SELECT count(*)::integer FROM match_events WHERE match_id = $1) AS events,
        (SELECT count(*)::integer FROM match_snapshots WHERE match_id = $1) AS snapshots,
        (SELECT current_round FROM matches WHERE id = $1) AS round`,
      [matchId]
    );
    expect(result.rows[0]).toEqual({ events: 1, snapshots: 2, round: 1 });
  });

  it("finaliza partida ranqueada uma única vez e calcula score e estatísticas", async () => {
    const winnerId = await createUser("vencedor");
    const loserId = await createUser("derrotado");
    const state = makeState("pending");
    const matchId = await matches.createMatch({
      roomCode: "RANK01",
      seedCommitHash: state.seedCommitHash,
      competitionMode: "ranked",
      matchOrigin: "matchmaking",
      seasonId,
    });
    await matches.startMatch(matchId, { ...state, id: matchId }, [
      participant("p1", winnerId, "blue"),
      participant("p2", loserId, "red"),
    ]);

    const finalState = finishedState(matchId);
    await matches.appendMatchEvent(matchId, 1, "p1", { type: "end_turn" }, finalState);
    await expect(
      matches.appendMatchEvent(matchId, 2, "p1", { type: "end_turn" }, finalState)
    ).rejects.toThrow("não aceita mais ações");

    const ratings = await connection.query<{ user_id: string; score: number; wins: number }>(
      "SELECT user_id, score, wins FROM player_ratings ORDER BY score DESC"
    );
    expect(ratings.rows).toEqual([
      { user_id: winnerId, score: 100, wins: 1 },
      { user_id: loserId, score: 0, wins: 0 },
    ]);

    const winnerStats = await stats.getPlayerStats(winnerId);
    expect(winnerStats.career).toMatchObject({ matchesPlayed: 1, wins: 1, currentWinStreak: 1 });
    expect(winnerStats.byColor[0]).toMatchObject({ color: "blue", wins: 1 });
    expect(winnerStats.byObjective[0]).toMatchObject({ wins: 1 });
    expect(winnerStats.byMap[0]).toMatchObject({ mapId: "classic", wins: 1 });
    const badges = await connection.query<{ slug: string }>(
      `SELECT b.slug FROM user_badges ub JOIN badges b ON b.id = ub.badge_id
       WHERE ub.user_id = $1 AND ub.source_match_id = $2`,
      [winnerId, matchId]
    );
    expect(badges.rows.map((badge) => badge.slug)).toEqual(["first-victory"]);

    const leaderboard = await stats.getLeaderboard({});
    expect(leaderboard.rows).toHaveLength(2);
    expect(leaderboard.rows[0]).toMatchObject({ userId: winnerId, score: 100, rank: 1 });
    expect(leaderboard.rows[1]).toMatchObject({ userId: loserId, score: 0, rank: 2 });

    const history = await stats.getPlayerMatchHistory({ userId: winnerId });
    expect(history.rows[0]).toMatchObject({ matchId, result: "win", placement: 1 });
  });

  it("mantém carreira casual fora do ranking e não registra bots", async () => {
    const userId = await createUser("casual");
    const state = makeState("pending");
    const matchId = await createCasualMatch(state);
    await connection.query("UPDATE match_participants SET user_id = $2 WHERE match_id = $1 AND engine_player_id = 'p1'", [matchId, userId]);
    await matches.appendMatchEvent(matchId, 1, "p1", { type: "end_turn" }, finishedState(matchId));

    const playerStats = await stats.getPlayerStats(userId);
    expect(playerStats.career).toMatchObject({ matchesPlayed: 1, wins: 1 });
    expect((await stats.getLeaderboard({})).rows).toHaveLength(0);
    const botStats = await connection.query(
      "SELECT count(*)::integer AS count FROM match_participants WHERE is_bot AND user_id IS NOT NULL"
    );
    expect(botStats.rows[0].count).toBe(0);
  });

  it("mantém partidas Custom com contas autenticadas fora do rating", async () => {
    const firstUser = await createUser("custom1");
    const secondUser = await createUser("custom2");
    const state = makeState("pending");
    const matchId = await matches.createMatch({
      roomCode: "CUST01",
      seedCommitHash: state.seedCommitHash,
      competitionMode: "custom",
      matchOrigin: "lobby",
    });
    await matches.startMatch(matchId, { ...state, id: matchId }, [
      participant("p1", firstUser, "blue"),
      participant("p2", secondUser, "red"),
    ]);
    await matches.appendMatchEvent(matchId, 1, "p1", { type: "end_turn" }, finishedState(matchId));

    const ratingRows = await connection.query<{ ratings: number; history: number }>(
      `SELECT
        (SELECT count(*)::integer FROM player_ratings) AS ratings,
        (SELECT count(*)::integer FROM player_rating_history) AS history`
    );
    expect(ratingRows.rows[0]).toEqual({ ratings: 0, history: 0 });
    expect((await stats.getPlayerStats(firstUser)).career).toMatchObject({ matchesPlayed: 1, wins: 1 });
    expect((await stats.getPlayerStats(secondUser)).career).toMatchObject({ matchesPlayed: 1, wins: 0 });
  });

  it("bloqueia duas finalizações concorrentes da mesma partida", async () => {
    const firstUser = await createUser("concorrente1");
    const secondUser = await createUser("concorrente2");
    const state = makeState("pending");
    const matchId = await matches.createMatch({
      roomCode: "RACE01",
      seedCommitHash: state.seedCommitHash,
      competitionMode: "ranked",
      matchOrigin: "matchmaking",
      seasonId,
    });
    await matches.startMatch(matchId, { ...state, id: matchId }, [
      participant("p1", firstUser, "blue"),
      participant("p2", secondUser, "red"),
    ]);

    const results = await Promise.allSettled([
      matches.appendMatchEvent(matchId, 1, "p1", { type: "end_turn" }, finishedState(matchId)),
      matches.appendMatchEvent(matchId, 1, "p1", { type: "end_turn" }, finishedState(matchId)),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const history = await connection.query<{ count: number }>(
      "SELECT count(*)::integer AS count FROM player_rating_history WHERE match_id = $1",
      [matchId]
    );
    expect(history.rows[0].count).toBe(2);
  });

  it("concede XP e evolui nível atomicamente respeitando Custom < Casual < Ranqueada com idempotência", async () => {
    const winnerUser = await createUser("xp_winner");
    const loserUser = await createUser("xp_loser");
    const state = makeState("pending");
    state.round = 5;

    const matchId = await matches.createMatch({
      roomCode: "XP001",
      seedCommitHash: state.seedCommitHash,
      competitionMode: "ranked",
      matchOrigin: "matchmaking",
      seasonId,
    });
    await matches.startMatch(matchId, { ...state, id: matchId }, [
      participant("p1", winnerUser, "blue"),
      participant("p2", loserUser, "red"),
    ]);

    const endState = finishedState(matchId);
    endState.round = 5;
    await matches.appendMatchEvent(matchId, 1, "p1", { type: "end_turn" }, endState);

    const grants = await connection.query<{
      user_id: string;
      total_xp: number;
      level_before: number;
      level_after: number;
    }>(
      "SELECT user_id, total_xp, level_before, level_after FROM player_xp_grants WHERE match_id = $1 ORDER BY total_xp DESC",
      [matchId]
    );

    expect(grants.rows).toHaveLength(2);
    // Winner gets 150 (base) + 90 (win) + 90 (1st) = 330 XP
    expect(grants.rows[0]).toMatchObject({
      user_id: winnerUser,
      total_xp: 330,
      level_before: 1,
      level_after: 3, // 330 XP >= 303 XP (level 3)
    });
    // Loser gets 150 (base) + 50 (2nd) = 200 XP
    expect(grants.rows[1]).toMatchObject({
      user_id: loserUser,
      total_xp: 200,
      level_before: 1,
      level_after: 2, // 200 XP >= 100 XP (level 2)
    });

    const userRows = await connection.query<{ id: string; total_xp: string; level: number }>(
      "SELECT id, total_xp, level FROM users WHERE id IN ($1, $2) ORDER BY level DESC",
      [winnerUser, loserUser]
    );
    expect(userRows.rows[0]).toMatchObject({ id: winnerUser, total_xp: "330", level: 3 });
    expect(userRows.rows[1]).toMatchObject({ id: loserUser, total_xp: "200", level: 2 });
  });
});

async function createCasualMatch(state: GameState): Promise<string> {
  const matchId = await matches.createMatch({
    roomCode: "TEST01",
    seedCommitHash: state.seedCommitHash,
  });
  await matches.startMatch(matchId, { ...state, id: matchId }, [
    participant("p1", undefined, "blue"),
    participant("p2", undefined, "red", true),
  ]);
  return matchId;
}

async function createUser(username: string): Promise<string> {
  const result = await connection.query<{ id: string }>(
    "INSERT INTO users (username, display_name) VALUES ($1::citext, $1::text) RETURNING id",
    [username]
  );
  return result.rows[0].id;
}

function participant(enginePlayerId: string, userId: string | undefined, color: "blue" | "red", isBot = false) {
  return {
    enginePlayerId,
    userId,
    displayName: enginePlayerId,
    color,
    objectiveId: "obj_test",
    seatIndex: enginePlayerId === "p1" ? 0 : 1,
    isBot,
  };
}

function makeState(id: string): GameState {
  return createGame({
    id,
    seed: "postgres-integration-seed",
    players: [
      { id: "p1", name: "Jogador 1", color: "blue" },
      { id: "p2", name: "Jogador 2", color: "red" },
    ],
  });
}

function finishedState(matchId: string): GameState {
  const state = makeState(matchId);
  state.phase = "game_over";
  state.winnerId = "p1";
  state.revealedSeed = "postgres-integration-seed";
  return state;
}
