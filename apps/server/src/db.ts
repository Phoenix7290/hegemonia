import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const dbPath = process.env.DB_PATH ?? "./data/hegemonia.db";
mkdirSync(dirname(dbPath), { recursive: true });

export const sqlite = new DatabaseSync(dbPath);
sqlite.exec("PRAGMA journal_mode = WAL;");

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS matches (
    id TEXT PRIMARY KEY,
    room_code TEXT NOT NULL,
    status TEXT NOT NULL,
    winner_name TEXT,
    winner_color TEXT,
    round INTEGER NOT NULL DEFAULT 1,
    seed_commit_hash TEXT NOT NULL,
    revealed_seed TEXT,
    state_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS match_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id TEXT NOT NULL,
    step INTEGER NOT NULL,
    player_id TEXT NOT NULL,
    action_json TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
`);

export interface MatchRow {
  id: string;
  roomCode: string;
  status: string;
  winnerName: string | null;
  winnerColor: string | null;
  round: number;
  seedCommitHash: string;
  revealedSeed: string | null;
  stateJson: string;
  updatedAt: number;
}

const upsertMatchStmt = sqlite.prepare(`
  INSERT INTO matches (
    id, room_code, status, winner_name, winner_color, round,
    seed_commit_hash, revealed_seed, state_json, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    status = excluded.status,
    winner_name = excluded.winner_name,
    winner_color = excluded.winner_color,
    round = excluded.round,
    revealed_seed = excluded.revealed_seed,
    state_json = excluded.state_json,
    updated_at = excluded.updated_at
`);

const insertEventStmt = sqlite.prepare(`
  INSERT INTO match_events (match_id, step, player_id, action_json, created_at)
  VALUES (?, ?, ?, ?, ?)
`);

const listRecentMatchesStmt = sqlite.prepare(`
  SELECT
    id,
    room_code AS roomCode,
    status,
    winner_name AS winnerName,
    winner_color AS winnerColor,
    round,
    seed_commit_hash AS seedCommitHash,
    revealed_seed AS revealedSeed,
    updated_at AS updatedAt
  FROM matches
  ORDER BY updated_at DESC
  LIMIT 15
`);

export function saveMatchSnapshot(row: MatchRow): void {
  upsertMatchStmt.run(
    row.id,
    row.roomCode,
    row.status,
    row.winnerName,
    row.winnerColor,
    row.round,
    row.seedCommitHash,
    row.revealedSeed,
    row.stateJson,
    row.updatedAt
  );
}

export function appendMatchEvent(
  matchId: string,
  step: number,
  playerId: string,
  actionJson: string
): void {
  insertEventStmt.run(matchId, step, playerId, actionJson, Date.now());
}

export function getRecentMatches() {
  return listRecentMatchesStmt.all();
}
