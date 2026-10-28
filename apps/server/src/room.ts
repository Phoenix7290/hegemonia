import { Room, type Client } from "@colyseus/core";
import { randomBytes } from "node:crypto";
import {
  GameActionSchema,
  PlayerColorSchema,
  type GameAction,
  type GameState,
  type PlayerColor,
} from "@hegemonia/shared";
import { CLASSIC_MAP } from "@hegemonia/maps";
import {
  applyAction,
  createGame,
  createPlayerView,
  createSeededRng,
  findValidTradeTriplet,
  type SeededRng,
} from "@hegemonia/engine";
import { appendMatchEvent, createMatch, startMatch } from "./db.js";

interface LobbyPlayer {
  token: string;
  sessionId: string;
  name: string;
  color: PlayerColor;
  isHost: boolean;
  isBot: boolean;
  connected: boolean;
  userId?: string;
}

const ALL_COLORS: PlayerColor[] = ["blue", "red", "green", "yellow", "black", "white"];

export class HegemoniaRoom extends Room {
  maxClients = 12;
  private roomCode = "";
  private matchId = "";
  private secretSeed = "";
  private rng!: SeededRng;
  private lobbyPlayers: LobbyPlayer[] = [];
  private gameState: GameState | null = null;
  private stepCounter = 0;
  private actionQueue: Promise<void> = Promise.resolve();
  private turnTimerSeconds = Number(process.env.TURN_TIMER_DEFAULT ?? 120);
  private turnDeadline = 0;
  private timerInterval: NodeJS.Timeout | null = null;

  onCreate(options: { roomCode?: string; name?: string; token?: string }) {
    this.roomCode = (
      options.roomCode?.toUpperCase() ||
      randomBytes(3).toString("hex").toUpperCase()
    ).slice(0, 6);
    this.roomId = this.roomCode;
    this.secretSeed = randomBytes(16).toString("hex");
    this.rng = createSeededRng(this.secretSeed);

    this.setMetadata({
      roomCode: this.roomCode,
      status: "lobby",
      playersCount: 0,
    });

    // Lobby messages
    this.onMessage("choose_color", (client, payload: { color: string }) => {
      if (this.gameState) return;
      const parsed = PlayerColorSchema.safeParse(payload?.color);
      if (!parsed.success) return;
      const taken = this.lobbyPlayers.some(
        (p) => p.color === parsed.data && p.sessionId !== client.sessionId
      );
      if (taken) {
        client.send("error_msg", { message: "Cor já escolhida por outro jogador." });
        return;
      }
      const player = this.lobbyPlayers.find((p) => p.sessionId === client.sessionId);
      if (player) {
        player.color = parsed.data;
        this.broadcastRoomState();
      }
    });

    this.onMessage("add_bot", (client) => {
      if (this.gameState) return;
      const caller = this.lobbyPlayers.find((p) => p.sessionId === client.sessionId);
      if (!caller?.isHost) return;
      if (this.lobbyPlayers.length >= 6) {
        client.send("error_msg", { message: "Máximo de 6 jogadores atingido." });
        return;
      }
      const freeColor =
        ALL_COLORS.find((c) => !this.lobbyPlayers.some((p) => p.color === c)) ?? "black";
      const botIndex = this.lobbyPlayers.filter((p) => p.isBot).length + 1;
      const botToken = `bot_${botIndex}_${randomBytes(3).toString("hex")}`;
      this.lobbyPlayers.push({
        token: botToken,
        sessionId: botToken,
        name: `General IA #${botIndex}`,
        color: freeColor,
        isHost: false,
        isBot: true,
        connected: true,
      });
      this.broadcastRoomState();
    });

    this.onMessage("remove_bot", (client, payload: { token: string }) => {
      if (this.gameState) return;
      const caller = this.lobbyPlayers.find((p) => p.sessionId === client.sessionId);
      if (!caller?.isHost) return;
      this.lobbyPlayers = this.lobbyPlayers.filter(
        (p) => !(p.isBot && p.token === payload?.token)
      );
      this.broadcastRoomState();
    });

    this.onMessage("start_game", (client) => {
      this.enqueueAction(async () => {
        if (this.gameState) return;
        const caller = this.lobbyPlayers.find((p) => p.sessionId === client.sessionId);
        if (!caller?.isHost) {
          client.send("error_msg", { message: "Apenas o anfitrião pode iniciar a partida." });
          return;
        }
        if (this.lobbyPlayers.length < 2) {
          client.send("error_msg", { message: "São necessários pelo menos 2 jogadores." });
          return;
        }

        try {
          const players = this.lobbyPlayers.map((p) => ({
            id: p.token,
            name: p.name,
            color: p.color,
          }));
          const provisional = createGame({ id: "pending", seed: this.secretSeed, players });
          this.matchId = await createMatch({ roomCode: this.roomCode, seedCommitHash: provisional.seedCommitHash });
          const nextState = createGame({ id: this.matchId, seed: this.secretSeed, players });
          await startMatch(
            this.matchId,
            nextState,
            this.lobbyPlayers.map((player) => {
              const gamePlayer = nextState.players.find((candidate) => candidate.id === player.token)!;
              return {
                enginePlayerId: player.token,
                userId: player.userId,
                displayName: player.name,
                color: player.color,
                objectiveId: gamePlayer.objective.id,
                seatIndex: nextState.players.indexOf(gamePlayer),
                isBot: player.isBot,
              };
            })
          );
          this.gameState = nextState;
          this.resetTurnTimer();
          this.broadcastRoomState();
          this.checkAndRunBotTurn();
        } catch (error) {
          const message = error instanceof Error ? error.message : "Não foi possível iniciar a partida.";
          client.send("error_msg", { message });
        }
      });
    });

    this.onMessage("return_to_lobby", (client) => {
      this.enqueueAction(async () => {
        const caller = this.lobbyPlayers.find((p) => p.sessionId === client.sessionId);
        if (!caller?.isHost) {
          client.send("error_msg", { message: "Apenas o anfitrião pode retornar a sala ao lobby." });
          return;
        }
        if (this.gameState && !this.gameState.winnerId && this.gameState.phase !== "game_over") {
          client.send("error_msg", { message: "A partida ainda está em andamento." });
          return;
        }
        this.gameState = null;
        this.matchId = "";
        this.secretSeed = randomBytes(16).toString("hex");
        this.rng = createSeededRng(this.secretSeed);
        this.turnDeadline = 0;
        this.setMetadata({
          roomCode: this.roomCode,
          status: "lobby",
          playersCount: this.lobbyPlayers.length,
        });
        this.broadcastRoomState();
      });
    });

    this.onMessage("game_action", (client, rawAction: unknown) => {
      const parsed = GameActionSchema.safeParse(rawAction);
      if (!parsed.success) {
        client.send("error_msg", { message: "Formato de ação inválido." });
        return;
      }

      this.enqueueAction(async () => {
        if (!this.gameState) return;
        const lobbyPlayer = this.lobbyPlayers.find((p) => p.sessionId === client.sessionId);
        if (!lobbyPlayer) return;
        try {
          await this.executePlayerAction(lobbyPlayer.token, parsed.data);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : "Ação inválida.";
          client.send("error_msg", { message });
        }
      });
    });

    this.onMessage("chat", (client, payload: { text: string }) => {
      const sender = this.lobbyPlayers.find((p) => p.sessionId === client.sessionId);
      const text = String(payload?.text ?? "").trim().slice(0, 240);
      if (!sender || !text) return;
      if (this.gameState) {
        this.enqueueAction(async () => {
          if (!this.gameState) return;
          this.gameState.log.push(`[COMMS] ${sender.name}: ${text}`);
          this.broadcastRoomState();
        });
      } else {
        this.broadcast("chat_msg", { from: sender.name, color: sender.color, text });
      }
    });

    this.timerInterval = setInterval(() => {
      if (!this.gameState || this.gameState.phase === "game_over") return;
      if (Date.now() > this.turnDeadline) {
        this.enqueueAction(() => this.handleTurnTimeout());
      }
    }, 1000);
  }

  onJoin(client: Client, options: { name?: string; token?: string }) {
    const token = String(options?.token || client.sessionId);
    const name = String(options?.name || "General").trim().slice(0, 24) || "General";

    // Check if returning player by session token
    const existing = this.lobbyPlayers.find((p) => p.token === token);
    if (existing) {
      existing.sessionId = client.sessionId;
      existing.connected = true;
      existing.name = name;
      if (this.gameState) {
        const gp = this.gameState.players.find((p) => p.id === token);
        if (gp) gp.connected = true;
      }
      this.broadcastRoomState();
      return;
    }

    if (this.gameState) {
      // Join as spectator
      this.sendStateToClient(client, null);
      return;
    }

    if (this.lobbyPlayers.length >= 6) {
      client.send("error_msg", { message: "Sala cheia (máx 6 jogadores)." });
      return;
    }

    const freeColor =
      ALL_COLORS.find((c) => !this.lobbyPlayers.some((p) => p.color === c)) ?? "blue";
    this.lobbyPlayers.push({
      token,
      sessionId: client.sessionId,
      name,
      color: freeColor,
      isHost: this.lobbyPlayers.length === 0,
      isBot: false,
      connected: true,
    });

    this.setMetadata({
      roomCode: this.roomCode,
      status: this.gameState ? "playing" : "lobby",
      playersCount: this.lobbyPlayers.length,
    });
    this.broadcastRoomState();
  }

  onLeave(client: Client) {
    const player = this.lobbyPlayers.find((p) => p.sessionId === client.sessionId);
    if (!player) return;

    if (!this.gameState) {
      this.lobbyPlayers = this.lobbyPlayers.filter((p) => p.token !== player.token);
      if (player.isHost && this.lobbyPlayers.length > 0) {
        const nextHuman = this.lobbyPlayers.find((p) => !p.isBot) ?? this.lobbyPlayers[0];
        nextHuman.isHost = true;
      }
    } else {
      player.connected = false;
      const gp = this.gameState.players.find((p) => p.id === player.token);
      if (gp) gp.connected = false;
    }
    this.broadcastRoomState();
  }

  async onDispose() {
    if (this.timerInterval) clearInterval(this.timerInterval);
    await this.actionQueue;
  }

  private enqueueAction(operation: () => Promise<void>): void {
    this.actionQueue = this.actionQueue.then(operation).catch((error: unknown) => {
      console.error(`Falha na fila da sala ${this.roomCode}:`, error);
    });
  }

  private resetTurnTimer() {
    this.turnDeadline = Date.now() + this.turnTimerSeconds * 1000;
  }

  private async executePlayerAction(playerId: string, action: GameAction): Promise<void> {
    if (!this.gameState) return;
    const prevTurn = this.gameState.turnIndex;
    const nextState = applyAction(this.gameState, playerId, action, this.rng, CLASSIC_MAP);
    const nextStep = this.stepCounter + 1;

    if (nextState.phase === "game_over") {
      nextState.revealedSeed = this.secretSeed;
    }
    for (const player of nextState.players) {
      player.connected = this.lobbyPlayers.find((entry) => entry.token === player.id)?.connected ?? true;
    }

    await appendMatchEvent(this.matchId, nextStep, playerId, action, nextState);
    this.gameState = nextState;
    this.stepCounter = nextStep;

    if (nextState.turnIndex !== prevTurn) {
      this.resetTurnTimer();
    }

    this.broadcastRoomState();
    this.checkAndRunBotTurn();
  }

  private async handleTurnTimeout(): Promise<void> {
    if (!this.gameState || this.gameState.phase === "game_over") return;
    const current = this.gameState.players[this.gameState.turnIndex];
    const timedOutPlayerId = current.id;
    this.gameState.log.push(
      `[TEMPO] Tempo esgotado para ${current.name}. Turno encerrado automaticamente.`
    );

    const mapById = new Map(CLASSIC_MAP.territories.map((t) => [t.id, t]));

    for (let guard = 0; guard < 6; guard++) {
      const gs = this.gameState as GameState | null;
      if (!gs || gs.phase === "game_over") break;
      const active = gs.players[gs.turnIndex];
      if (!active || active.id !== timedOutPlayerId) break;

      if (active.cards.length >= 5) {
        const triplet = findValidTradeTriplet(active.cards);
        if (triplet) {
          await this.executePlayerAction(timedOutPlayerId, { type: "trade_cards", cardIds: triplet });
          continue;
        }
      }

      if (gs.pendingConquest) {
        await this.executePlayerAction(timedOutPlayerId, {
          type: "occupy",
          armies: gs.pendingConquest.minMove,
        });
        continue;
      }

      if (gs.phase === "deploy" && active.unplacedArmies > 0) {
        const owned = Object.values(gs.territories).filter(
          (t) => t.ownerId === timedOutPlayerId
        );
        const frontline = owned.filter((t) =>
          mapById
            .get(t.id)!
            .neighbors.some((n) => gs.territories[n].ownerId !== timedOutPlayerId)
        );
        const target = (frontline.length > 0 ? frontline : owned)[0];
        if (target) {
          await this.executePlayerAction(timedOutPlayerId, {
            type: "deploy",
            territoryId: target.id,
            armies: active.unplacedArmies,
          });
          continue;
        }
      }

      await this.executePlayerAction(timedOutPlayerId, { type: "end_turn" });
      break;
    }

    this.resetTurnTimer();
  }

  private checkAndRunBotTurn() {
    if (!this.gameState || this.gameState.phase === "game_over") return;
    const current = this.gameState.players[this.gameState.turnIndex];
    const lobbyEntry = this.lobbyPlayers.find((p) => p.token === current.id);
    if (!lobbyEntry?.isBot) return;

    setTimeout(() => {
      if (!this.gameState || this.gameState.phase === "game_over") return;
      const active = this.gameState.players[this.gameState.turnIndex];
      if (active.id === current.id) {
        this.enqueueAction(() => this.runSingleBotStep(current.id));
      }
    }, 450);
  }

  private async runSingleBotStep(playerId: string): Promise<void> {
    if (!this.gameState || this.gameState.phase === "game_over") return;
    const player = this.gameState.players.find((p) => p.id === playerId);
    if (!player) return;
    const mapById = new Map(CLASSIC_MAP.territories.map((t) => [t.id, t]));

    try {
      const triplet = findValidTradeTriplet(player.cards);
      if (triplet && (this.gameState.phase === "deploy" || player.cards.length >= 5)) {
        await this.executePlayerAction(playerId, { type: "trade_cards", cardIds: triplet });
        return;
      }

      if (this.gameState.phase === "deploy" && player.unplacedArmies > 0) {
        const owned = Object.values(this.gameState.territories).filter(
          (t) => t.ownerId === playerId
        );
        const frontline = owned.filter((t) =>
          mapById
            .get(t.id)!
            .neighbors.some((n) => this.gameState!.territories[n].ownerId !== playerId)
        );
        const target = (frontline.length > 0 ? frontline : owned)[0];
        await this.executePlayerAction(playerId, {
          type: "deploy",
          territoryId: target.id,
          armies: player.unplacedArmies,
        });
        return;
      }

      if (this.gameState.pendingConquest) {
        await this.executePlayerAction(playerId, {
          type: "occupy",
          armies: this.gameState.pendingConquest.maxMove,
        });
        return;
      }

      if (this.gameState.phase === "attack") {
        const owned = Object.values(this.gameState.territories).filter(
          (t) => t.ownerId === playerId && t.armies >= 3
        );
        for (const from of owned) {
          const enemies = mapById
            .get(from.id)!
            .neighbors.map((n) => this.gameState!.territories[n])
            .filter((n) => n.ownerId !== playerId && from.armies > n.armies);
          if (enemies.length > 0) {
            enemies.sort((a, b) => a.armies - b.armies);
            await this.executePlayerAction(playerId, {
              type: "attack",
              fromTerritoryId: from.id,
              toTerritoryId: enemies[0].id,
            });
            return;
          }
        }
        await this.executePlayerAction(playerId, { type: "end_attack" });
        return;
      }

      if (this.gameState.phase === "maneuver") {
        await this.executePlayerAction(playerId, { type: "end_turn" });
      }
    } catch {
      // Fallback if stuck
      if (this.gameState.phase === "attack") {
        await this.executePlayerAction(playerId, { type: "end_attack" });
      } else if (this.gameState.phase === "maneuver") {
        await this.executePlayerAction(playerId, { type: "end_turn" });
      }
    }
  }

  private sendStateToClient(client: Client, viewerToken: string | null) {
    client.send("room_state", {
      roomCode: this.roomCode,
      status: this.gameState ? "playing" : "lobby",
      turnDeadline: this.turnDeadline,
      myPlayerId: viewerToken,
      lobbyPlayers: this.lobbyPlayers.map((p) => ({
        token: p.token,
        name: p.name,
        color: p.color,
        isHost: p.isHost,
        isBot: p.isBot,
        connected: p.connected,
      })),
      game: this.gameState ? createPlayerView(this.gameState, viewerToken) : null,
    });
  }

  private broadcastRoomState() {
    for (const client of this.clients) {
      const lobbyPlayer = this.lobbyPlayers.find((p) => p.sessionId === client.sessionId);
      this.sendStateToClient(client, lobbyPlayer?.token ?? null);
    }
  }
}
