import { Room, type Client } from "@colyseus/core";
import { randomBytes } from "node:crypto";
import {
  DOCTRINE_LIST,
  DoctrineIdSchema,
  GameActionSchema,
  HEGEMONIA_VERSION,
  PlayerColorSchema,
  SCENARIO_BY_ID,
  SESSION_REPLACED_CLOSE_CODE,
  isDoctrineAvailableInLobby,
  type AuthUser,
  type CompetitionMode,
  type DoctrineId,
  type GameAction,
  type GameState,
  type MatchOrigin,
  type PlayerColor,
  type TacticalScenarioId,
} from "@hegemonia/shared";
import { authenticateToken } from "./auth-service.js";
import { sessionTokenFromHeaders } from "./http.js";
import { CLASSIC_MAP, isSeaLink } from "@hegemonia/maps";
import {
  applyAction,
  checkNavalBlockade,
  createGame,
  createPlayerView,
  createSeededRng,
  findValidTradeTriplet,
  type SeededRng,
} from "@hegemonia/engine";
import { appendMatchEvent, createMatch, startMatch } from "./db.js";
import { RoomCommunications } from "./communications.js";
import {
  advanceDisconnectedTurnTimeout,
  applyConsentedLeaveTransition,
  applyDisconnectTimeoutTransition,
  applyLeaveMatchTransition,
  restoreHumanOnReconnect,
  synchronizeHumanHost,
  type BotTakeoverMode,
} from "./room-membership.js";
import { matchmakingService } from "./matchmaking.js";

interface LobbyPlayer {
  token: string;
  sessionId: string;
  name: string;
  color: PlayerColor;
  doctrineId?: DoctrineId | null;
  isHost: boolean;
  isBot: boolean;
  connected: boolean;
  isReady?: boolean;
  userId?: string;
  username?: string;
  avatarUrl?: string | null;
  level?: number | null;
  disconnectedTurns?: number;
  botTakeoverMode?: BotTakeoverMode;
  leftMatchExplicitly?: boolean;
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
  turnTimerSeconds?: number;
  scenarioId?: TacticalScenarioId;
}

const ALL_COLORS: PlayerColor[] = [
  "blue",
  "red",
  "green",
  "dark_green",
  "yellow",
  "orange",
  "pink",
  "purple",
  "black",
  "white",
];

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
  private botStepTimer: NodeJS.Timeout | null = null;
  private handlingTurnTimeout = false;
  private disconnectTimeouts = new Map<string, NodeJS.Timeout>();
  private disposeTimeout: NodeJS.Timeout | null = null;
  private recentObjectivesByUser = new Map<string, string[]>();
  private communications!: RoomCommunications;
  private competitionMode: CompetitionMode = "custom";
  private matchOrigin: MatchOrigin = "lobby";
  private seasonId?: string;
  private expectedUserIds = new Set<string>();
  private rulesConfig: Record<string, unknown> = {};
  private selectedScenarioId: TacticalScenarioId = "standard";

  onCreate(options: HegemoniaRoomOptions) {
    this.autoDispose = false;
    this.competitionMode = options.competitionMode ?? "custom";
    this.matchOrigin = options.matchOrigin ?? "lobby";
    this.seasonId = options.seasonId;
    this.expectedUserIds = new Set(options.expectedUserIds ?? []);
    this.rulesConfig = options.rulesConfig ?? {};
    if (options.scenarioId && options.scenarioId in SCENARIO_BY_ID) {
      this.selectedScenarioId = options.scenarioId;
    } else if (
      typeof this.rulesConfig.scenarioId === "string" &&
      this.rulesConfig.scenarioId in SCENARIO_BY_ID
    ) {
      this.selectedScenarioId = this.rulesConfig.scenarioId as TacticalScenarioId;
    }
    if (typeof options.turnTimerSeconds === "number" && options.turnTimerSeconds > 0) {
      this.turnTimerSeconds = options.turnTimerSeconds;
    } else if (
      typeof this.rulesConfig.turnTimerSeconds === "number" &&
      (this.rulesConfig.turnTimerSeconds as number) > 0
    ) {
      this.turnTimerSeconds = Number(this.rulesConfig.turnTimerSeconds);
    }
    this.communications = new RoomCommunications({
      getPlayers: () => this.lobbyPlayers,
      getClients: () => [...this.clients],
      areAllied: (firstPlayerId, secondPlayerId) => this.arePlayersAllied(firstPlayerId, secondPlayerId),
    });
    this.roomCode = (
      options.roomCode?.toUpperCase() ||
      randomBytes(3).toString("hex").toUpperCase()
    ).slice(0, 6);
    this.roomId = this.roomCode;
    this.secretSeed = randomBytes(16).toString("hex");
    this.rng = createSeededRng(this.secretSeed);

    this.syncMetadata();

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

    this.onMessage("choose_doctrine", (client, payload: { doctrineId: string }) => {
      if (this.gameState) return;
      const parsed = DoctrineIdSchema.safeParse(payload?.doctrineId);
      if (!parsed.success) return;
      const player = this.lobbyPlayers.find((p) => p.sessionId === client.sessionId);
      if (player) {
        const otherDoctrines = this.lobbyPlayers
          .filter((p) => p.sessionId !== client.sessionId)
          .map((p) => p.doctrineId);
        if (!isDoctrineAvailableInLobby(parsed.data, otherDoctrines)) {
          const limit = parsed.data === "extermination" ? 1 : 2;
          client.send("error_msg", {
            message: `Limite atingido: esta doutrina permite no máximo ${limit} general(is) por partida.`,
          });
          return;
        }
        player.doctrineId = parsed.data;
        this.broadcastRoomState();
      }
    });

    this.onMessage("set_turn_timer", (client, payload: { seconds: number }) => {
      if (this.gameState) return;
      const caller = this.lobbyPlayers.find((p) => p.sessionId === client.sessionId);
      if (!caller?.isHost) return;
      const sec = Number(payload?.seconds);
      if (sec >= 15 && sec <= 300) {
        this.turnTimerSeconds = sec;
        this.broadcastRoomState();
      }
    });

    this.onMessage("select_scenario", (client, payload: { scenarioId: string }) => {
      if (this.gameState) return;
      const caller = this.lobbyPlayers.find((p) => p.sessionId === client.sessionId);
      if (!caller?.isHost) return;
      if (this.competitionMode !== "custom") return;
      if (payload?.scenarioId && payload.scenarioId in SCENARIO_BY_ID) {
        this.selectedScenarioId = payload.scenarioId as TacticalScenarioId;
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
      const botDoctrine = DOCTRINE_LIST[(botIndex - 1) % DOCTRINE_LIST.length].id;
      this.lobbyPlayers.push({
        token: botToken,
        sessionId: botToken,
        name: `General IA #${botIndex}`,
        color: freeColor,
        doctrineId: botDoctrine,
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

    this.onMessage("set_ready", (client, payload: { ready?: boolean }) => {
      if (this.gameState) return;
      const player = this.lobbyPlayers.find((p) => p.sessionId === client.sessionId);
      if (player && !player.isBot) {
        if (payload?.ready && !player.doctrineId) {
          client.send("error_msg", {
            message: "Selecione uma Doutrina Militar Nacional antes de confirmar prontidão.",
          });
          return;
        }
        player.isReady = Boolean(payload?.ready);
        this.broadcastRoomState();
      }
    });

    this.onMessage(
      "leave_match",
      (client, payload: { botTakeoverMode?: "immediate" | "after_2_turns" }) => {
        const mode: BotTakeoverMode =
          payload?.botTakeoverMode === "immediate" ? "immediate" : "after_2_turns";
        const sessionId = client.sessionId;
        this.enqueueAction(async () => {
          const player = this.lobbyPlayers.find((p) => p.sessionId === sessionId);
          if (!player) return;
          const pendingTimer = this.disconnectTimeouts.get(player.token);
          if (pendingTimer) {
            clearTimeout(pendingTimer);
            this.disconnectTimeouts.delete(player.token);
          }
          const inActiveMatch = Boolean(this.gameState && this.gameState.phase !== "game_over");
          const immediateTakeover = applyLeaveMatchTransition(player, mode, inActiveMatch);
          if (inActiveMatch && this.gameState) {
            if (immediateTakeover) {
              this.gameState.log.push(
                `[IA] COMANDO TRANSFERIDO: ${player.name} retirou-se da campanha e delegou controle imediato ao General IA.`
              );
            } else {
              this.gameState.log.push(
                `[AUSÊNCIA] ${player.name} deixou a sala. Um General IA assumirá após 2 rodadas caso não retorne.`
              );
            }
          }
          player.sessionId = "";
          this.purgePlayer(player);
          if (immediateTakeover) {
            this.checkAndRunBotTurn();
          }
        });
      }
    );

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
        const missingDoctrine = this.lobbyPlayers.filter((p) => !p.isBot && !p.doctrineId);
        if (missingDoctrine.length > 0) {
          client.send("error_msg", {
            message: "Todos os generais devem selecionar uma Doutrina Militar Nacional antes do início.",
          });
          return;
        }
        const unready = this.lobbyPlayers.filter((p) => !p.isHost && !p.isBot && !p.isReady);
        if (unready.length > 0) {
          client.send("error_msg", {
            message: "Todos os generais devem confirmar prontidão antes do início da operação.",
          });
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
          const players = this.lobbyPlayers.map((p, idx) => ({
            id: p.token,
            name: p.name,
            color: p.color,
            doctrineId:
              p.doctrineId ??
              (p.isBot ? DOCTRINE_LIST[idx % DOCTRINE_LIST.length].id : null),
            recentObjectiveIds: this.recentObjectivesByUser.get(p.userId ?? p.token),
          }));
          const provisional = createGame({
            id: "pending",
            seed: this.secretSeed,
            players,
            scenarioId: this.selectedScenarioId,
          });
          this.matchId = await createMatch({
            roomCode: this.roomCode,
            seedCommitHash: provisional.seedCommitHash,
            competitionMode: this.competitionMode,
            matchOrigin: this.matchOrigin,
            seasonId: this.seasonId,
            rulesConfig: { ...this.rulesConfig, scenarioId: this.selectedScenarioId },
          });
          const nextState = createGame({
            id: this.matchId,
            seed: this.secretSeed,
            players,
            scenarioId: this.selectedScenarioId,
          });
          for (const gp of nextState.players) {
            const lobbyEntry = players.find((lp) => lp.id === gp.id);
            if (lobbyEntry?.doctrineId) {
              gp.doctrineId = lobbyEntry.doctrineId;
            }
            const fullLobbyEntry = this.lobbyPlayers.find((lp) => lp.token === gp.id);
            if (fullLobbyEntry && !fullLobbyEntry.isBot) {
              gp.pendingObjectiveChoice = true;
            }
          }
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
                doctrineId: gamePlayer.doctrineId ?? player.doctrineId ?? undefined,
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
    this.onMessage("tactical_ping", (client, payload: unknown) => {
      this.communications.sendTacticalPing(client, payload);
    });

    this.timerInterval = setInterval(() => {
      if (!this.gameState || this.gameState.phase === "game_over") return;
      if (!this.handlingTurnTimeout && Date.now() > this.turnDeadline) {
        this.handlingTurnTimeout = true;
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
    options: { name?: string; token?: string; doctrineId?: DoctrineId },
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
      existing.name = name;
      const wasBotTakeover = restoreHumanOnReconnect(existing);
      if (authUser) {
        existing.userId = authUser.id;
        existing.username = authUser.username;
        existing.avatarUrl = authUser.avatarUrl;
        existing.level = authUser.level;
      }
      if (this.gameState) {
        const gp = this.gameState.players.find((p) => p.id === token);
        if (gp) gp.connected = true;
        if (wasBotTakeover) {
          this.gameState.log.push(
            `[COMANDO RESTAURADO] ${existing.name} reconectou-se e reassumiu o controle de suas forças!`
          );
        }
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
    const parsedDoc = DoctrineIdSchema.safeParse(options?.doctrineId);
    this.lobbyPlayers.push({
      token,
      sessionId: client.sessionId,
      name,
      color: freeColor,
      doctrineId: parsedDoc.success ? parsedDoc.data : null,
      isHost: this.lobbyPlayers.length === 0,
      isBot: false,
      connected: true,
      userId: authUser?.id,
      username: authUser?.username,
      avatarUrl: authUser?.avatarUrl,
      level: authUser?.level ?? 1,
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
      const inActiveMatch = Boolean(this.gameState && this.gameState.phase !== "game_over");
      const immediateTakeover = applyConsentedLeaveTransition(player, inActiveMatch);
      if (immediateTakeover && this.gameState) {
        this.gameState.log.push(
          `[IA] COMANDO TRANSFERIDO: ${player.name} abandonou a partida e a IA assumiu suas forças.`
        );
      }
      player.sessionId = "";
      this.purgePlayer(player);
      if (immediateTakeover) {
        this.checkAndRunBotTurn();
      }
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
        this.enqueueAction(async () => {
          const inActiveMatch = Boolean(this.gameState && this.gameState.phase !== "game_over");
          const immediateTakeover = applyDisconnectTimeoutTransition(player, inActiveMatch);
          if (immediateTakeover && this.gameState) {
            this.gameState.log.push(
              `[IA] COMANDO TRANSFERIDO: ${player.name} desconectou-se e a IA assumiu o comando.`
            );
          }
          player.sessionId = "";
          this.purgePlayer(player);
          if (immediateTakeover) {
            this.checkAndRunBotTurn();
          }
        });
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
    if (this.botStepTimer) clearTimeout(this.botStepTimer);
    if (this.disposeTimeout) clearTimeout(this.disposeTimeout);
    for (const t of this.disconnectTimeouts.values()) clearTimeout(t);
    this.disconnectTimeouts.clear();
    this.communications.dispose();
    await this.actionQueue;
    for (const player of this.lobbyPlayers) {
      if (player.userId) matchmakingService.releaseParticipant(player.userId, this.roomCode);
    }
  }

  private arePlayersAllied(firstPlayerId: string, secondPlayerId: string): boolean {
    if (!this.gameState) return false;
    if (firstPlayerId === secondPlayerId) return true;
    const hasAlliance = (this.gameState.treaties ?? []).some(
      (t) =>
        t.status === "active" &&
        t.type === "alliance" &&
        ((t.fromPlayerId === firstPlayerId && t.toPlayerId === secondPlayerId) ||
          (t.fromPlayerId === secondPlayerId && t.toPlayerId === firstPlayerId))
    );
    if (hasAlliance) return true;
    return (this.gameState.coalitions ?? []).some(
      (c) =>
        c.memberPlayerIds.includes(firstPlayerId) && c.memberPlayerIds.includes(secondPlayerId)
    );
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
    const isFirstRound = this.gameState ? this.gameState.round === 1 : true;
    const durationSeconds = isFirstRound ? 60 : this.turnTimerSeconds;
    this.turnDeadline = Date.now() + durationSeconds * 1000;
  }

  private async executePlayerAction(playerId: string, action: GameAction): Promise<void> {
    if (!this.gameState) return;
    const prevTurn = this.gameState.turnIndex;
    const nextState = applyAction(this.gameState, playerId, action, this.rng, CLASSIC_MAP);
    const nextStep = this.stepCounter + 1;

    if (nextState.phase === "game_over") {
      nextState.revealedSeed = this.secretSeed;
    }
    if (action.type === "choose_objective") {
      const lobbyEntry = this.lobbyPlayers.find((entry) => entry.token === playerId);
      const userKey = lobbyEntry?.userId ?? playerId;
      const history = this.recentObjectivesByUser.get(userKey) ?? [];
      const updated = [
        action.objectiveId,
        ...history.filter((id) => id !== action.objectiveId),
      ].slice(0, 4);
      this.recentObjectivesByUser.set(userKey, updated);
    }
    for (const player of nextState.players) {
      const lobbyEntry = this.lobbyPlayers.find((entry) => entry.token === player.id);
      player.connected = lobbyEntry?.connected ?? true;
      if (player.doctrineId && lobbyEntry) {
        lobbyEntry.doctrineId = player.doctrineId;
      }
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

  /**
   * Seleciona um território válido para posicionamento (ignorando territórios cercados sem suprimento)
   */
  private pickDeployableTerritory(gs: GameState, playerId: string) {
    const mapById = new Map(CLASSIC_MAP.territories.map((t) => [t.id, t]));
    const owned = Object.values(gs.territories).filter((t) => t.ownerId === playerId);
    const nonEncircled = owned.filter((t) => !t.isEncircled);
    const pool = nonEncircled.length > 0 ? nonEncircled : owned;
    const frontline = pool.filter((t) =>
      mapById.get(t.id)?.neighbors.some((n) => gs.territories[n]?.ownerId !== playerId)
    );
    return (frontline.length > 0 ? frontline : pool)[0] ?? null;
  }

  private async handleTurnTimeout(): Promise<void> {
    try {
      if (!this.gameState || this.gameState.phase === "game_over") return;
      if (Date.now() <= this.turnDeadline) return;
      const current = this.gameState.players[this.gameState.turnIndex];
      const timedOutPlayerId = current.id;
      this.gameState.log.push(
        `[TEMPO] Tempo esgotado para ${current.name}. Turno encerrado automaticamente.`
      );

      for (let guard = 0; guard < 6; guard++) {
        const gs = this.gameState as GameState | null;
        if (!gs || gs.phase === "game_over") break;
        const active = gs.players[gs.turnIndex];
        if (!active || active.id !== timedOutPlayerId) break;

        try {
          if (active.pendingObjectiveChoice && active.availableObjectives?.length) {
            await this.executePlayerAction(timedOutPlayerId, {
              type: "choose_objective",
              objectiveId: active.availableObjectives[0].id,
            });
            continue;
          }

          if (gs.pendingConquest) {
            await this.executePlayerAction(timedOutPlayerId, {
              type: "occupy",
              armies: gs.pendingConquest.minMove,
            });
            continue;
          }

          if (active.cards.length >= 5) {
            const triplet = findValidTradeTriplet(active.cards);
            if (triplet) {
              await this.executePlayerAction(timedOutPlayerId, {
                type: "trade_cards",
                cardIds: triplet,
              });
              continue;
            }
          }

          if (gs.phase === "deploy" && active.unplacedArmies > 0) {
            const target = this.pickDeployableTerritory(gs, timedOutPlayerId);
            if (target) {
              if (target.isEncircled) {
                target.isEncircled = false;
              }
              await this.executePlayerAction(timedOutPlayerId, {
                type: "deploy",
                territoryId: target.id,
                armies: active.unplacedArmies,
              });
              continue;
            }
            active.unplacedArmies = 0;
            await this.executePlayerAction(timedOutPlayerId, { type: "end_turn" });
            break;
          }

          if (gs.phase === "deploy" && active.unplacedArmies === 0 && gs.round > 1) {
            await this.executePlayerAction(timedOutPlayerId, { type: "end_deploy" });
            continue;
          }

          await this.executePlayerAction(timedOutPlayerId, { type: "end_turn" });
          break;
        } catch {
          active.unplacedArmies = 0;
          gs.pendingConquest = null;
          await this.executePlayerAction(timedOutPlayerId, { type: "end_turn" }).catch(() => undefined);
          break;
        }
      }

      const timedOutLobbyEntry = this.lobbyPlayers.find((p) => p.token === timedOutPlayerId);
      if (timedOutLobbyEntry && advanceDisconnectedTurnTimeout(timedOutLobbyEntry)) {
        if (this.gameState) {
          this.gameState.log.push(
            `[IA] CONTROLE IA ATIVADO: Após 2 rodadas ausente, a IA assumiu o comando de ${timedOutLobbyEntry.name}!`
          );
        }
        this.broadcastRoomState();
      }

      this.resetTurnTimer();
      this.checkAndRunBotTurn();
    } finally {
      this.handlingTurnTimeout = false;
    }
  }

  private checkAndRunBotTurn() {
    if (this.botStepTimer) {
      clearTimeout(this.botStepTimer);
      this.botStepTimer = null;
    }
    if (!this.gameState || this.gameState.phase === "game_over") return;
    const current = this.gameState.players[this.gameState.turnIndex];
    if (!current) return;
    const lobbyEntry = this.lobbyPlayers.find((p) => p.token === current.id);
    if (!lobbyEntry?.isBot) return;

    const scheduledPlayerId = current.id;
    this.botStepTimer = setTimeout(() => {
      this.botStepTimer = null;
      if (!this.gameState || this.gameState.phase === "game_over") return;
      const active = this.gameState.players[this.gameState.turnIndex];
      const activeLobby = this.lobbyPlayers.find((p) => p.token === active?.id);
      if (active && active.id === scheduledPlayerId && activeLobby?.isBot) {
        this.enqueueAction(() => this.runSingleBotStep(scheduledPlayerId));
      }
    }, 450);
  }

  private async runSingleBotStep(playerId: string): Promise<void> {
    if (!this.gameState || this.gameState.phase === "game_over") return;
    const current = this.gameState.players[this.gameState.turnIndex];
    const lobbyEntry = this.lobbyPlayers.find((p) => p.token === playerId);
    if (!current || current.id !== playerId || !lobbyEntry?.isBot) return;
    const player = current;
    const mapById = new Map(CLASSIC_MAP.territories.map((t) => [t.id, t]));

    try {
      if (player.pendingObjectiveChoice && player.availableObjectives?.length) {
        await this.executePlayerAction(playerId, {
          type: "choose_objective",
          objectiveId: player.availableObjectives[0].id,
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

      const triplet = findValidTradeTriplet(player.cards);
      if (triplet && (this.gameState.phase === "deploy" || player.cards.length >= 5)) {
        await this.executePlayerAction(playerId, { type: "trade_cards", cardIds: triplet });
        return;
      }

      if (this.gameState.phase === "deploy" && player.unplacedArmies > 0) {
        const target = this.pickDeployableTerritory(this.gameState, playerId);
        if (!target) {
          player.unplacedArmies = 0;
          await this.executePlayerAction(playerId, { type: "end_turn" });
          return;
        }
        if (target.isEncircled) {
          target.isEncircled = false;
        }
        await this.executePlayerAction(playerId, {
          type: "deploy",
          territoryId: target.id,
          armies: player.unplacedArmies,
        });
        return;
      }

      if (this.gameState.phase === "deploy" && player.unplacedArmies === 0) {
        if (this.gameState.round > 1) {
          await this.executePlayerAction(playerId, { type: "end_deploy" });
        } else {
          await this.executePlayerAction(playerId, { type: "end_turn" });
        }
        return;
      }

      if (this.gameState.phase === "attack") {
        const owned = Object.values(this.gameState.territories).filter(
          (t) =>
            t.ownerId === playerId &&
            t.armies >= 3 &&
            !(t.conqueredTurnRound === this.gameState!.round && !t.blitzkriegAvailable)
        );
        for (const from of owned) {
          const enemies = mapById
            .get(from.id)!
            .neighbors.map((n) => this.gameState!.territories[n])
            .filter((n) => {
              if (!n || n.ownerId === playerId || from.armies <= n.armies) return false;
              if (isSeaLink(from.id, n.id)) {
                const blockade = checkNavalBlockade(this.gameState!, from.id, n.id, playerId);
                if (blockade.isBlockaded) return false;
              }
              return true;
            });
          if (enemies.length > 0) {
            enemies.sort((a, b) => a.armies - b.armies);
            try {
              await this.executePlayerAction(playerId, {
                type: "attack",
                fromTerritoryId: from.id,
                toTerritoryId: enemies[0].id,
              });
              return;
            } catch {
              continue;
            }
          }
        }
        await this.executePlayerAction(playerId, { type: "end_attack" });
        return;
      }

      if (this.gameState.phase === "maneuver") {
        await this.executePlayerAction(playerId, { type: "end_turn" });
      }
    } catch {
      if (!this.gameState) return;
      if (this.gameState.pendingConquest) {
        await this.executePlayerAction(playerId, {
          type: "occupy",
          armies: this.gameState.pendingConquest.minMove,
        }).catch(() => undefined);
      } else if (this.gameState.phase === "deploy") {
        player.unplacedArmies = 0;
        await this.executePlayerAction(playerId, { type: "end_turn" }).catch(() => undefined);
      } else if (this.gameState.phase === "attack") {
        await this.executePlayerAction(playerId, { type: "end_attack" }).catch(() => undefined);
      } else if (this.gameState.phase === "maneuver") {
        await this.executePlayerAction(playerId, { type: "end_turn" }).catch(() => undefined);
      }
    }
  }

  private sendStateToClient(client: Client, viewerToken: string | null) {
    client.send("room_state", {
      version: HEGEMONIA_VERSION,
      roomCode: this.roomCode,
      status: this.gameState ? "playing" : "lobby",
      competitionMode: this.competitionMode,
      matchOrigin: this.matchOrigin,
      turnDeadline: this.turnDeadline,
      turnTimerSeconds: this.gameState?.round === 1 ? 60 : this.turnTimerSeconds,
      selectedScenarioId: this.selectedScenarioId,
      myPlayerId: viewerToken,
      lobbyPlayers: this.lobbyPlayers.map((p) => ({
        token: p.token,
        name: p.name,
        color: p.color,
        doctrineId: this.gameState || p.token === viewerToken ? (p.doctrineId ?? null) : null,
        hasChosenDoctrine: Boolean(p.doctrineId),
        isHost: p.isHost,
        isBot: p.isBot,
        connected: p.connected,
        isReady: Boolean((p.isHost && p.doctrineId) || p.isReady),
        userId: p.userId ?? null,
        username: p.username ?? null,
        avatarUrl: p.avatarUrl ?? null,
        level: p.level ?? 1,
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