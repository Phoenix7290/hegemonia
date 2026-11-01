import { Room, type Client } from "@colyseus/core";
import { randomBytes } from "node:crypto";
import {
  GameActionSchema,
  PlayerColorSchema,
  SESSION_REPLACED_CLOSE_CODE,
  type AuthUser,
  type CompetitionMode,
  type GameAction,
  type GameState,
  type MatchOrigin,
  type PlayerColor,
} from "@hegemonia/shared";
import { authenticateToken } from "./auth-service.js";
import { sessionTokenFromHeaders } from "./http.js";
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
import { RoomCommunications } from "./communications.js";
import { synchronizeHumanHost } from "./room-membership.js";
import { matchmakingService } from "./matchmaking.js";

interface LobbyPlayer {
  token: string;
  sessionId: string;
  name: string;
  color: PlayerColor;
  isHost: boolean;
  isBot: boolean;
  connected: boolean;
  userId?: string;
  username?: string;
  avatarUrl?: string | null;
}

interface HegemoniaRoomOptions {
  roomCode?: string;
  name?: string;
  token?: string;
  competitionMode?: CompetitionMode;
  matchOrigin?: MatchOrigin;
  seasonId?: string;
  expectedUserIds?: string[];
  rulesConfig?: Record<string, unknown>;
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
  private disconnectTimeouts = new Map<string, NodeJS.Timeout>();
  private disposeTimeout: NodeJS.Timeout | null = null;
  private communications!: RoomCommunications;
  private competitionMode: CompetitionMode = "custom";
  private matchOrigin: MatchOrigin = "lobby";
  private seasonId?: string;
  private expectedUserIds = new Set<string>();
  private rulesConfig: Record<string, unknown> = {};

  onCreate(options: HegemoniaRoomOptions) {
    this.autoDispose = false;
    this.competitionMode = options.competitionMode ?? "custom";
    this.matchOrigin = options.matchOrigin ?? "lobby";
    this.seasonId = options.seasonId;
    this.expectedUserIds = new Set(options.expectedUserIds ?? []);
    this.rulesConfig = options.rulesConfig ?? {};
    this.communications = new RoomCommunications({
      getPlayers: () => this.lobbyPlayers,
      getClients: () => [...this.clients],
    });
    this.roomCode = (
      options.roomCode?.toUpperCase() ||
      randomBytes(3).toString("hex").toUpperCase()
    ).slice(0, 6);
    this.roomId = this.roomCode;
    this.secretSeed = randomBytes(16).toString("hex");
    this.rng = createSeededRng(this.secretSeed);

    this.syncMetadata();

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
      if (this.competitionMode !== "custom") {
        client.send("error_msg", { message: "Bots estão disponíveis apenas em salas Custom." });
        return;
      }
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
      this.syncMetadata();
      this.broadcastRoomState();
    });

    this.onMessage("remove_bot", (client, payload: { token: string }) => {
      if (this.gameState) return;
      const caller = this.lobbyPlayers.find((p) => p.sessionId === client.sessionId);
      if (!caller?.isHost) return;
      this.lobbyPlayers = this.lobbyPlayers.filter(
        (p) => !(p.isBot && p.token === payload?.token)
      );
      this.syncMetadata();
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
        const missingReservedPlayer = [...this.expectedUserIds].some((userId) =>
          !this.lobbyPlayers.some((player) => player.userId === userId && player.connected)
        );
        if (missingReservedPlayer) {
          client.send("error_msg", { message: "Aguarde todos os jogadores reservados se conectarem." });
          return;
        }

        try {
          const players = this.lobbyPlayers.map((p) => ({
            id: p.token,
            name: p.name,
            color: p.color,
          }));
          const provisional = createGame({ id: "pending", seed: this.secretSeed, players });
          this.matchId = await createMatch({
            roomCode: this.roomCode,
            seedCommitHash: provisional.seedCommitHash,
            competitionMode: this.competitionMode,
            matchOrigin: this.matchOrigin,
            seasonId: this.seasonId,
            rulesConfig: this.rulesConfig,
          });
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
          this.syncMetadata();
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
        this.syncMetadata();
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

    this.onMessage("comms_sync", (client) => this.communications.sync(client));
    this.onMessage("open_direct", (client, payload: unknown) => {
      this.communications.openDirect(client, payload);
    });
    this.onMessage("chat", (client, payload: unknown) => {
      this.communications.sendChat(client, payload);
    });
    this.onMessage("voice_join", (client, payload: unknown) => {
      this.communications.joinVoice(client, payload);
    });
    this.onMessage("voice_leave", (client, payload: unknown) => {
      this.communications.leaveVoice(client, payload);
    });
    this.onMessage("voice_signal", (client, payload: unknown) => {
      this.communications.relayVoiceSignal(client, payload);
    });

    this.timerInterval = setInterval(() => {
      if (!this.gameState || this.gameState.phase === "game_over") return;
      if (Date.now() > this.turnDeadline) {
        this.enqueueAction(() => this.handleTurnTimeout());
      }
    }, 1000);
    this.checkAutoDispose();
  }

  async onAuth(_client: Client, _options: unknown, context: { headers?: { cookie?: string } }) {
    const identity = await authenticateToken(sessionTokenFromHeaders(context.headers ?? {}));
    return { user: identity?.user ?? null };
  }

  onJoin(
    client: Client,
    options: { name?: string; token?: string },
    auth: { user?: AuthUser | null } | AuthUser | null
  ) {
    const authUser = auth && typeof auth === "object" && "user" in auth ? auth.user ?? null : (auth as AuthUser | null);
    if (this.matchOrigin === "matchmaking" && (!authUser || !this.expectedUserIds.has(authUser.id))) {
      throw new Error("Esta sala é reservada aos jogadores selecionados pelo matchmaking.");
    }
    const requestedToken = String(options?.token || client.sessionId);
    const existing = authUser
      ? this.lobbyPlayers.find((p) => p.userId === authUser.id)
      : this.lobbyPlayers.find((p) => p.token === requestedToken && !p.userId);
    if (!authUser && this.lobbyPlayers.some((p) => p.token === requestedToken && p.userId)) {
      throw new Error("Esta identidade de jogador pertence a uma conta autenticada.");
    }
    const token = existing?.token ?? requestedToken;
    const name = authUser?.displayName ?? (String(options?.name || "General").trim().slice(0, 24) || "General");

    if (existing) {
      if (authUser) matchmakingService.confirmParticipant(authUser.id, this.roomCode);
      const previousClient = existing.connected && existing.sessionId !== client.sessionId
        ? [...this.clients].find((candidate) => candidate.sessionId === existing.sessionId)
        : undefined;
      const pendingTimer = this.disconnectTimeouts.get(existing.token);
      if (pendingTimer) {
        clearTimeout(pendingTimer);
        this.disconnectTimeouts.delete(existing.token);
      }
      if (this.disposeTimeout) {
        clearTimeout(this.disposeTimeout);
        this.disposeTimeout = null;
      }
      this.communications.removePlayer(existing.token);
      existing.sessionId = client.sessionId;
      existing.connected = true;
      existing.name = name;
      if (authUser) {
        existing.userId = authUser.id;
        existing.username = authUser.username;
        existing.avatarUrl = authUser.avatarUrl;
      }
      if (this.gameState) {
        const gp = this.gameState.players.find((p) => p.id === token);
        if (gp) gp.connected = true;
      }
      synchronizeHumanHost(this.lobbyPlayers);
      this.syncMetadata();
      previousClient?.leave(SESSION_REPLACED_CLOSE_CODE, "Sessão substituída por uma nova conexão.");
      this.broadcastRoomState();
      return;
    }

    if (this.gameState) {
      this.sendStateToClient(client, null);
      return;
    }

    if (this.lobbyPlayers.length >= 6) {
      throw new Error("Sala cheia (máx 6 jogadores).");
    }

    if (authUser) matchmakingService.confirmParticipant(authUser.id, this.roomCode);
    if (this.disposeTimeout) {
      clearTimeout(this.disposeTimeout);
      this.disposeTimeout = null;
    }
    const freeColor = ALL_COLORS.find((c) => !this.lobbyPlayers.some((p) => p.color === c)) ?? "blue";
    this.lobbyPlayers.push({
      token,
      sessionId: client.sessionId,
      name,
      color: freeColor,
      isHost: this.lobbyPlayers.length === 0,
      isBot: false,
      connected: true,
      userId: authUser?.id,
      username: authUser?.username,
      avatarUrl: authUser?.avatarUrl,
    });

    synchronizeHumanHost(this.lobbyPlayers);
    this.syncMetadata();
    this.broadcastRoomState();
  }

  onLeave(client: Client, consented?: boolean) {
    const player = this.lobbyPlayers.find((p) => p.sessionId === client.sessionId);
    if (!player) return;
    this.communications.removePlayer(player.token);

    if (consented) {
      this.purgePlayer(player);
      return;
    }

    player.connected = false;
    if (this.gameState) {
      const gp = this.gameState.players.find((p) => p.id === player.token);
      if (gp) gp.connected = false;
    }

    const existingTimer = this.disconnectTimeouts.get(player.token);
    if (existingTimer) clearTimeout(existingTimer);

    const timer = setTimeout(() => {
      this.disconnectTimeouts.delete(player.token);
      if (!player.connected) {
        this.purgePlayer(player);
      }
    }, 60000);
    this.disconnectTimeouts.set(player.token, timer);

    this.syncMetadata();
    this.checkAutoDispose();
    this.broadcastRoomState();
  }

  private purgePlayer(player: LobbyPlayer) {
    player.connected = false;
    player.isHost = false;
    if (player.userId) matchmakingService.releaseParticipant(player.userId, this.roomCode);
    if (!this.gameState) {
      this.lobbyPlayers = this.lobbyPlayers.filter((p) => p.token !== player.token);
    } else {
      const gp = this.gameState.players.find((p) => p.id === player.token);
      if (gp) gp.connected = false;
    }
    synchronizeHumanHost(this.lobbyPlayers);
    this.syncMetadata();
    this.checkAutoDispose();
    this.broadcastRoomState();
  }

  private checkAutoDispose() {
    const hasActivePlayers = this.lobbyPlayers.some((p) => p.connected && !p.isBot);
    const hasPendingReconnects = this.disconnectTimeouts.size > 0;

    if (!hasActivePlayers && !hasPendingReconnects) {
      if (!this.disposeTimeout) {
        this.disposeTimeout = setTimeout(() => {
          const stillEmpty =
            !this.lobbyPlayers.some((p) => p.connected && !p.isBot) &&
            this.disconnectTimeouts.size === 0;
          if (stillEmpty) {
            this.disconnect();
          }
        }, 15000);
      }
    } else if (this.disposeTimeout) {
      clearTimeout(this.disposeTimeout);
      this.disposeTimeout = null;
    }
  }

  async onDispose() {
    if (this.timerInterval) clearInterval(this.timerInterval);
    if (this.disposeTimeout) clearTimeout(this.disposeTimeout);
    for (const t of this.disconnectTimeouts.values()) clearTimeout(t);
    this.disconnectTimeouts.clear();
    this.communications.dispose();
    await this.actionQueue;
    for (const player of this.lobbyPlayers) {
      if (player.userId) matchmakingService.releaseParticipant(player.userId, this.roomCode);
    }
  }

  private enqueueAction(operation: () => Promise<void>): void {
    this.actionQueue = this.actionQueue.then(operation).catch((error: unknown) => {
      console.error(`Falha na fila da sala ${this.roomCode}:`, error);
    });
  }

  private syncMetadata() {
    this.setMetadata({
      roomCode: this.roomCode,
      status: this.gameState ? "playing" : "lobby",
      playersCount: this.lobbyPlayers.length,
      competitionMode: this.competitionMode,
      matchOrigin: this.matchOrigin,
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
        const eligible = owned.filter((t) => !t.isEncircled);
        const candidatePool = eligible.length > 0 ? eligible : owned;
        const frontline = candidatePool.filter((t) =>
          mapById
            .get(t.id)!
            .neighbors.some((n) => gs.territories[n].ownerId !== timedOutPlayerId)
        );
        const target = (frontline.length > 0 ? frontline : candidatePool)[0];
        if (target) {
          try {
            await this.executePlayerAction(timedOutPlayerId, {
              type: "deploy",
              territoryId: target.id,
              armies: active.unplacedArmies,
            });
            continue;
          } catch (deployErr) {
            console.error(`[TIMEOUT AUTO-DEPLOY FAIL] ${timedOutPlayerId}:`, deployErr);
            active.unplacedArmies = 0;
          }
        }
      }

      try {
        await this.executePlayerAction(timedOutPlayerId, { type: "end_turn" });
      } catch (endErr) {
        console.error(`[TIMEOUT AUTO-END FAIL] ${timedOutPlayerId}:`, endErr);
      }
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
        // HEGEM-75: Only consider unencircled territories capable of receiving reinforcements
        const eligible = owned.filter((t) => !t.isEncircled);
        const candidatePool = eligible.length > 0 ? eligible : owned;
        const frontline = candidatePool.filter((t) =>
          mapById
            .get(t.id)!
            .neighbors.some((n) => this.gameState!.territories[n].ownerId !== playerId)
        );
        const target = (frontline.length > 0 ? frontline : candidatePool)[0];
        if (target) {
          await this.executePlayerAction(playerId, {
            type: "deploy",
            territoryId: target.id,
            armies: player.unplacedArmies,
          });
          return;
        }
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
          // HEGEM-25: Skip fatigued infantry territories that conquered this round without blitzkrieg
          if (from.conqueredTurnRound === this.gameState.round && !from.blitzkriegAvailable) {
            continue;
          }
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
      // Fallback if stuck (HEGEM-75: deploy fail-safe to prevent stalls)
      if (this.gameState.phase === "deploy") {
        const fallbackTarget = Object.values(this.gameState.territories).find(
          (t) => t.ownerId === playerId && !t.isEncircled
        );
        if (fallbackTarget && player.unplacedArmies > 0) {
          try {
            await this.executePlayerAction(playerId, {
              type: "deploy",
              territoryId: fallbackTarget.id,
              armies: player.unplacedArmies,
            });
            return;
          } catch {
            // Force progression if deploy action still fails
            player.unplacedArmies = 0;
            if (this.gameState.round === 1) {
              await this.executePlayerAction(playerId, { type: "end_turn" }).catch(() => {});
            } else {
              this.gameState.phase = "attack";
              this.broadcastRoomState();
              this.checkAndRunBotTurn();
            }
          }
        } else {
          // No unencircled fallback available, force progression
          player.unplacedArmies = 0;
          if (this.gameState.round === 1) {
            await this.executePlayerAction(playerId, { type: "end_turn" }).catch(() => {});
          } else {
            this.gameState.phase = "attack";
            this.broadcastRoomState();
            this.checkAndRunBotTurn();
          }
        }
      } else if (this.gameState.phase === "attack") {
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
      competitionMode: this.competitionMode,
      matchOrigin: this.matchOrigin,
      turnDeadline: this.turnDeadline,
      myPlayerId: viewerToken,
      lobbyPlayers: this.lobbyPlayers.map((p) => ({
        token: p.token,
        name: p.name,
        color: p.color,
        isHost: p.isHost,
        isBot: p.isBot,
        connected: p.connected,
        userId: p.userId ?? null,
        username: p.username ?? null,
        avatarUrl: p.avatarUrl ?? null,
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
