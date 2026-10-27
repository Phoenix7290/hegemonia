import type { PoolClient } from "pg";
import type { GameAction, GameState, PlayerColor } from "@hegemonia/shared";
import { query, withTransaction } from "./connection.js";

export interface CreateMatchInput {
  roomCode: string;
  seedCommitHash: string;
  rulesetVersion?: string;
  mapId?: string;
  gameMode?: "classic" | "roleplay";
  competitionMode?: "casual" | "ranked";
  seasonId?: string;
  rulesConfig?: Record<string, unknown>;
}

export interface MatchParticipantInput {
  enginePlayerId: string;
  userId?: string;
  displayName: string;
  color: PlayerColor;
  objectiveId?: string;
  doctrineId?: string;
  seatIndex: number;
  isBot: boolean;
}

export interface MatchRow {
  id: string;
  roomCode: string;
  status: string;
  mapId: string;
  gameMode: string;
  competitionMode: string;
  round: number;
  seedCommitHash: string;
  revealedSeed: string | null;
  startedAt: Date | null;
  endedAt: Date | null;
  updatedAt: Date;
}

export async function createMatch(input: CreateMatchInput): Promise<string> {
  const result = await query<{ id: string }>(
    `INSERT INTO matches (
      room_code, seed_commit_hash, ruleset_version, map_id, game_mode,
      competition_mode, season_id, rules_config, ranked_ineligible_reason
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING id`,
    [
      input.roomCode,
      input.seedCommitHash,
      input.rulesetVersion ?? "0.1.0",
      input.mapId ?? "classic",
      input.gameMode ?? "classic",
      input.competitionMode ?? "casual",
      input.seasonId ?? null,
      input.rulesConfig ?? {},
      input.competitionMode === "ranked" ? "Aguardando avaliação dos participantes" : null,
    ]
  );
  return result.rows[0].id;
}

export async function startMatch(
  matchId: string,
  state: GameState,
  participants: MatchParticipantInput[]
): Promise<void> {
  await withTransaction(async (client) => {
    const match = await lockMatch(client, matchId);
    if (match.status !== "lobby") {
      throw new Error("A partida já foi iniciada.");
    }

    const ranked = match.competition_mode === "ranked";
    const hasBots = participants.some((participant) => participant.isBot);
    const hasGuests = participants.some((participant) => !participant.userId);
    const rankedEligible = ranked && !hasBots && !hasGuests;
    const ineligibleReason = !ranked
      ? null
      : hasBots
        ? "Partidas com bots não são elegíveis"
        : hasGuests
          ? "Todos os participantes devem estar autenticados"
          : null;

    await client.query(
      `UPDATE matches
       SET status = 'playing', state_json = $2, started_at = now(), updated_at = now(),
           ranked_eligible = $3, ranked_ineligible_reason = $4
       WHERE id = $1`,
      [matchId, state, rankedEligible, ineligibleReason]
    );

    for (const participant of participants) {
      await client.query(
        `INSERT INTO match_participants (
          match_id, user_id, engine_player_id, display_name, color, objective_id,
          doctrine_id, seat_index, is_bot
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          matchId,
          participant.userId ?? null,
          participant.enginePlayerId,
          participant.displayName,
          participant.color,
          participant.objectiveId ?? null,
          participant.doctrineId ?? null,
          participant.seatIndex,
          participant.isBot,
        ]
      );
    }

    await insertSnapshot(client, matchId, 0, "start", state);
  });
}

export async function appendMatchEvent(
  matchId: string,
  sequence: number,
  playerId: string,
  action: GameAction,
  state: GameState
): Promise<void> {
  await withTransaction(async (client) => {
    const match = await lockMatch(client, matchId);
    if (match.status !== "playing") {
      throw new Error("A partida não aceita mais ações.");
    }

    const participant = await client.query<{ id: string }>(
      `SELECT id FROM match_participants
       WHERE match_id = $1 AND engine_player_id = $2`,
      [matchId, playerId]
    );
    const participantId = participant.rows[0]?.id;
    if (!participantId) {
      throw new Error("Participante não encontrado nesta partida.");
    }

    await client.query(
      `INSERT INTO match_events (match_id, participant_id, sequence, action_type, payload)
       VALUES ($1, $2, $3, $4, $5)`,
      [matchId, participantId, sequence, action.type, action]
    );

    await updateParticipantProgress(client, matchId, state, sequence);
    await insertSnapshot(
      client,
      matchId,
      sequence,
      state.phase === "game_over" ? "game_over" : "action",
      state
    );

    if (state.phase === "game_over") {
      await finalizeMatch(client, match, state);
    } else {
      await client.query(
        `UPDATE matches
         SET current_round = $2, state_json = $3, updated_at = now()
         WHERE id = $1`,
        [matchId, state.round, state]
      );
    }
  });
}

export async function getRecentMatches(limit = 15): Promise<MatchRow[]> {
  const result = await query<MatchRow>(
    `SELECT
      id, room_code AS "roomCode", status, map_id AS "mapId",
      game_mode AS "gameMode", competition_mode AS "competitionMode",
      current_round AS round, seed_commit_hash AS "seedCommitHash",
      revealed_seed AS "revealedSeed", started_at AS "startedAt",
      ended_at AS "endedAt", updated_at AS "updatedAt"
     FROM matches
     ORDER BY updated_at DESC, id DESC
     LIMIT $1`,
    [Math.min(Math.max(limit, 1), 100)]
  );
  return result.rows;
}

async function lockMatch(client: PoolClient, matchId: string) {
  const result = await client.query<{
    id: string;
    status: string;
    competition_mode: string;
    season_id: string | null;
    ranked_eligible: boolean;
  }>(
    `SELECT id, status, competition_mode, season_id, ranked_eligible
     FROM matches WHERE id = $1 FOR UPDATE`,
    [matchId]
  );
  const match = result.rows[0];
  if (!match) throw new Error("Partida não encontrada.");
  return match;
}

async function insertSnapshot(
  client: PoolClient,
  matchId: string,
  sequence: number,
  reason: "start" | "action" | "checkpoint" | "game_over",
  state: GameState
): Promise<void> {
  await client.query(
    `INSERT INTO match_snapshots (match_id, sequence, reason, state_json)
     VALUES ($1, $2, $3, $4)`,
    [matchId, sequence, reason, state]
  );
}

async function updateParticipantProgress(
  client: PoolClient,
  matchId: string,
  state: GameState,
  sequence: number
): Promise<void> {
  for (const player of state.players) {
    const territories = Object.values(state.territories).filter(
      (territory) => territory.ownerId === player.id
    );
    await client.query(
      `UPDATE match_participants
       SET peak_territories = greatest(peak_territories, $3),
           eliminated_at_sequence = CASE
             WHEN $4 AND eliminated_at_sequence IS NULL THEN $5
             ELSE eliminated_at_sequence
           END,
           turns_played = (
             SELECT count(*) FROM match_events
             WHERE participant_id = match_participants.id AND action_type = 'end_turn'
           ),
           updated_at = now()
       WHERE match_id = $1 AND engine_player_id = $2`,
      [matchId, player.id, territories.length, player.eliminated, sequence]
    );
  }
}

async function finalizeMatch(
  client: PoolClient,
  match: { id: string; competition_mode: string; season_id: string | null; ranked_eligible: boolean },
  state: GameState
): Promise<void> {
  if (!state.winnerId) {
    throw new Error("Uma partida finalizada precisa ter um vencedor.");
  }

  const participants = await client.query<{
    id: string;
    user_id: string | null;
    engine_player_id: string;
    is_bot: boolean;
    eliminated_at_sequence: number | null;
  }>(
    `SELECT id, user_id, engine_player_id, is_bot, eliminated_at_sequence
     FROM match_participants WHERE match_id = $1
     ORDER BY user_id NULLS LAST, id`,
    [match.id]
  );
  const placements = calculatePlacements(state, participants.rows);

  for (const participant of participants.rows) {
    const player = state.players.find((candidate) => candidate.id === participant.engine_player_id);
    if (!player) throw new Error("Participante ausente no estado final.");
    const territories = Object.values(state.territories).filter(
      (territory) => territory.ownerId === player.id
    );
    const won = player.id === state.winnerId;
    const result = won ? "win" : "loss";
    const eliminatedBy = player.eliminatedBy
      ? participants.rows.find((candidate) => candidate.engine_player_id === player.eliminatedBy)?.id ?? null
      : null;

    await client.query(
      `UPDATE match_participants
       SET result = $3, placement = $4, final_territories = $5, final_armies = $6,
           eliminated_by_participant_id = $7, updated_at = now()
       WHERE id = $1 AND match_id = $2`,
      [
        participant.id,
        match.id,
        result,
        placements.get(player.id),
        territories.length,
        territories.reduce((total, territory) => total + territory.armies, 0),
        eliminatedBy,
      ]
    );
  }

  await client.query(
    `UPDATE matches
     SET status = 'finished', current_round = $2, revealed_seed = $3,
         state_json = $4, ended_at = now(), updated_at = now()
     WHERE id = $1`,
    [match.id, state.round, state.revealedSeed ?? null, state]
  );

  if (match.ranked_eligible && match.season_id) {
    for (const participant of participants.rows) {
      if (!participant.user_id || participant.is_bot) continue;
      const won = participant.engine_player_id === state.winnerId;
      await applyRankedResult(
        client,
        participant.id,
        participant.user_id,
        match.id,
        match.season_id,
        won
      );
    }
  }
}

function calculatePlacements(
  state: GameState,
  participants: { engine_player_id: string; eliminated_at_sequence: number | null }[]
): Map<string, number> {
  const eliminationSequences = new Map(
    participants.map((participant) => [
      participant.engine_player_id,
      participant.eliminated_at_sequence,
    ])
  );
  const remaining = state.players
    .filter((player) => player.id !== state.winnerId)
    .sort((a, b) => {
      if (a.eliminated !== b.eliminated) return a.eliminated ? 1 : -1;
      if (a.eliminated && b.eliminated) {
        return (eliminationSequences.get(b.id) ?? 0) - (eliminationSequences.get(a.id) ?? 0);
      }
      const territoriesA = Object.values(state.territories).filter((t) => t.ownerId === a.id).length;
      const territoriesB = Object.values(state.territories).filter((t) => t.ownerId === b.id).length;
      return territoriesB - territoriesA || state.players.indexOf(a) - state.players.indexOf(b);
    });

  return new Map([
    [state.winnerId!, 1],
    ...remaining.map((player, index) => [player.id, index + 2] as [string, number]),
  ]);
}

async function applyRankedResult(
  client: PoolClient,
  participantId: string,
  userId: string,
  matchId: string,
  seasonId: string,
  won: boolean
): Promise<void> {
  const queue = "classic_ffa";
  await client.query(
    `INSERT INTO player_ratings (user_id, season_id, queue)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, season_id, queue) DO NOTHING`,
    [userId, seasonId, queue]
  );
  const current = await client.query<{ score: number }>(
    `SELECT score FROM player_ratings
     WHERE user_id = $1 AND season_id = $2 AND queue = $3
     FOR UPDATE`,
    [userId, seasonId, queue]
  );
  const previousScore = current.rows[0].score;
  const delta = won ? 100 : 0;
  const newScore = previousScore + delta;

  await client.query(
    `UPDATE player_ratings
     SET score = $4, matches_played = matches_played + 1,
         wins = wins + $5, updated_at = now()
     WHERE user_id = $1 AND season_id = $2 AND queue = $3`,
    [userId, seasonId, queue, newScore, won ? 1 : 0]
  );
  await client.query(
    `INSERT INTO player_rating_history (
      user_id, season_id, match_id, participant_id, queue,
      previous_score, new_score, score_delta, result
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      userId,
      seasonId,
      matchId,
      participantId,
      queue,
      previousScore,
      newScore,
      delta,
      won ? "win" : "loss",
    ]
  );
}
