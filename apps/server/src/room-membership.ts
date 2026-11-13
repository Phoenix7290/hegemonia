export interface HostMember {
  isHost: boolean;
  isBot: boolean;
  connected: boolean;
}

export type BotTakeoverMode = "immediate" | "after_2_turns";

export interface TakeoverMember extends HostMember {
  token: string;
  sessionId: string;
  disconnectedTurns?: number;
  botTakeoverMode?: BotTakeoverMode;
  leftMatchExplicitly?: boolean;
}

export function synchronizeHumanHost<T extends HostMember>(players: T[]): void {
  if (players.some((player) => player.isHost && player.connected && !player.isBot)) return;

  for (const player of players) player.isHost = false;
  const nextHost = players.find((player) => player.connected && !player.isBot);
  if (nextHost) nextHost.isHost = true;
}

/**
 * Transitions a human player who explicitly invoked `leave_match` during an active match.
 * Returns `true` when AI takeover activates immediately.
 */
export function applyLeaveMatchTransition<T extends TakeoverMember>(
  player: T,
  mode: BotTakeoverMode,
  inActiveMatch: boolean
): boolean {
  player.botTakeoverMode = mode;
  player.leftMatchExplicitly = true;
  player.connected = false;
  player.isHost = false;
  if (!inActiveMatch) {
    return false;
  }
  if (mode === "immediate") {
    player.isBot = true;
    player.disconnectedTurns = 0;
    return true;
  }
  player.disconnectedTurns = 0;
  return false;
}

/**
 * Transitions a human player who left with `consented = true` during an active match
 * without sending `leave_match` first. Takes over immediately so the room never stalls.
 */
export function applyConsentedLeaveTransition<T extends TakeoverMember>(
  player: T,
  inActiveMatch: boolean
): boolean {
  player.connected = false;
  player.isHost = false;
  if (!inActiveMatch || player.isBot || player.leftMatchExplicitly) {
    return false;
  }
  player.botTakeoverMode = "immediate";
  player.isBot = true;
  player.disconnectedTurns = 0;
  return true;
}

/**
 * Transitions a disconnected player when the 60s reconnect grace period expires.
 */
export function applyDisconnectTimeoutTransition<T extends TakeoverMember>(
  player: T,
  inActiveMatch: boolean
): boolean {
  player.connected = false;
  player.isHost = false;
  if (!inActiveMatch || player.isBot) {
    return false;
  }
  if (player.botTakeoverMode === "immediate") {
    player.isBot = true;
    return true;
  }
  player.botTakeoverMode = player.botTakeoverMode ?? "after_2_turns";
  player.disconnectedTurns = player.disconnectedTurns ?? 0;
  return false;
}

/**
 * Restores human control when an existing non-bot player reconnects to the match.
 * Returns `true` if AI had temporarily taken over and was relinquished back to the human.
 */
export function restoreHumanOnReconnect<T extends TakeoverMember>(player: T): boolean {
  if (player.token.startsWith("bot_")) {
    return false;
  }
  const wasBot = player.isBot;
  player.isBot = false;
  player.connected = true;
  player.disconnectedTurns = 0;
  player.botTakeoverMode = undefined;
  player.leftMatchExplicitly = false;
  return wasBot;
}

/**
 * Advances missed-turn tracking after a turn timeout for a disconnected human player.
 * Returns `true` on the exact turn that AI assumes command.
 */
export function advanceDisconnectedTurnTimeout<T extends TakeoverMember>(player: T): boolean {
  if (player.connected || player.isBot) {
    return false;
  }
  player.disconnectedTurns = (player.disconnectedTurns ?? 0) + 1;
  if (player.botTakeoverMode === "immediate" || player.disconnectedTurns >= 2) {
    player.isBot = true;
    return true;
  }
  return false;
}
