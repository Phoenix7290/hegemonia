import { randomUUID } from "node:crypto";
import {
  ChatSendSchema,
  DirectChannelOpenSchema,
  GLOBAL_CHANNEL_ID,
  VoiceJoinSchema,
  VoiceLeaveSchema,
  VoiceSignalSchema,
  directChannelId,
  type CommunicationChannel,
  type CommunicationMessage,
  type CommunicationSyncPayload,
  type IceServerConfig,
  type PlayerColor,
  type VoicePresence,
  type VoiceSignalInput,
} from "@hegemonia/shared";

export interface CommunicationClient {
  sessionId: string;
  send(type: string, payload: unknown): void;
}

export interface CommunicationPlayer {
  token: string;
  sessionId: string;
  name: string;
  color: PlayerColor;
  isBot: boolean;
  connected: boolean;
  avatarUrl?: string | null;
}

interface CommunicationsHost {
  getPlayers(): CommunicationPlayer[];
  getClients(): CommunicationClient[];
  areAllied?(firstPlayerId: string, secondPlayerId: string): boolean;
}

interface RoomCommunicationsOptions {
  iceServers?: IceServerConfig[];
  now?: () => number;
  createId?: () => string;
}

const HISTORY_LIMIT = 100;
const CHAT_RATE_WINDOW_MS = 2_000;
const CHAT_RATE_LIMIT = 6;
const SIGNAL_RATE_WINDOW_MS = 10_000;
const SIGNAL_RATE_LIMIT = 300;
const INTEL_REPEAT_WINDOW_MS = 45_000;

export class RoomCommunications {
  private readonly channels = new Map<string, CommunicationChannel>();
  private readonly messages = new Map<string, CommunicationMessage[]>();
  private readonly voiceChannels = new Map<string, Set<string>>();
  private readonly activeVoiceByPlayer = new Map<string, string>();
  private readonly chatRate = new Map<string, number[]>();
  private readonly signalRate = new Map<string, number[]>();
  private readonly lastIntelByChannel = new Map<string, number>();
  private readonly now: () => number;
  private readonly createId: () => string;
  private readonly iceServers: IceServerConfig[];

  constructor(
    private readonly host: CommunicationsHost,
    options: RoomCommunicationsOptions = {}
  ) {
    this.now = options.now ?? Date.now;
    this.createId = options.createId ?? randomUUID;
    this.iceServers = options.iceServers ?? resolveIceServers();
    const globalChannel: CommunicationChannel = {
      id: GLOBAL_CHANNEL_ID,
      kind: "global",
      memberIds: [],
      createdAt: new Date(this.now()).toISOString(),
    };
    this.channels.set(globalChannel.id, globalChannel);
    this.messages.set(globalChannel.id, []);
  }

  sync(client: CommunicationClient): void {
    const player = this.playerForClient(client);
    if (!player) return;
    const channels = [...this.channels.values()].filter((channel) =>
      this.canAccess(player, channel)
    );
    const channelIds = new Set(channels.map((channel) => channel.id));
    const messages = [...this.messages.values()]
      .flat()
      .filter((message) => channelIds.has(message.channelId))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const voice = [...this.voiceChannels.entries()]
      .filter(([channelId]) => channelIds.has(channelId))
      .map(([channelId, playerIds]) => ({
        channelId,
        playerIds: [...playerIds].sort((a, b) => a.localeCompare(b)),
      }));
    const payload: CommunicationSyncPayload = { channels, messages, voice };
    client.send("comms_sync", payload);
    client.send("voice_config", { iceServers: this.iceServers });
  }

  openDirect(client: CommunicationClient, rawPayload: unknown): CommunicationChannel | null {
    const sender = this.playerForClient(client);
    const parsed = DirectChannelOpenSchema.safeParse(rawPayload);
    if (!sender || sender.isBot || !parsed.success) return null;
    const target = this.host
      .getPlayers()
      .find(
        (player) =>
          player.token === parsed.data.playerId && player.connected && !player.isBot
      );
    if (!target || target.token === sender.token) {
      client.send("error_msg", { message: "Comandante indisponível para frequência direta." });
      return null;
    }

    const id = directChannelId(sender.token, target.token);
    let channel = this.channels.get(id);
    if (!channel) {
      channel = {
        id,
        kind: "direct",
        memberIds: [sender.token, target.token].sort((a, b) => a.localeCompare(b)),
        createdAt: new Date(this.now()).toISOString(),
      };
      this.channels.set(id, channel);
      this.messages.set(id, []);
    }
    for (const memberId of channel.memberIds) {
      const memberClient = this.clientForPlayer(memberId);
      if (memberClient) this.sync(memberClient);
    }
    return channel;
  }

  sendChat(client: CommunicationClient, rawPayload: unknown): void {
    const sender = this.playerForClient(client);
    const parsed = ChatSendSchema.safeParse(rawPayload);
    if (!sender || sender.isBot || !parsed.success) return;
    const channel = this.channels.get(parsed.data.channelId);
    if (!channel || !this.canAccess(sender, channel)) {
      client.send("error_msg", { message: "Frequência de comunicações indisponível." });
      return;
    }
    if (!this.consumeRate(this.chatRate, sender.token, CHAT_RATE_WINDOW_MS, CHAT_RATE_LIMIT)) {
      client.send("error_msg", { message: "Transmissões muito frequentes. Aguarde um instante." });
      return;
    }

    const message: CommunicationMessage = {
      id: this.createId(),
      channelId: channel.id,
      kind: "message",
      senderId: sender.token,
      senderName: sender.name,
      senderColor: sender.color,
      senderAvatarUrl: sender.avatarUrl ?? null,
      text: parsed.data.text,
      createdAt: new Date(this.now()).toISOString(),
    };
    this.appendAndSend(channel, message);
    if (channel.kind === "direct") this.maybeReportContact(channel);
  }

  joinVoice(client: CommunicationClient, rawPayload: unknown): void {
    const player = this.playerForClient(client);
    const parsed = VoiceJoinSchema.safeParse(rawPayload);
    if (!player || player.isBot || !parsed.success) return;
    const channel = this.channels.get(parsed.data.channelId);
    if (!channel || !this.canAccess(player, channel)) {
      client.send("error_msg", { message: "Linha de rádio indisponível." });
      return;
    }

    const previousChannelId = this.activeVoiceByPlayer.get(player.token);
    if (previousChannelId === channel.id) {
      this.sync(client);
      return;
    }
    if (previousChannelId) this.removeFromVoice(player.token, previousChannelId);

    let participants = this.voiceChannels.get(channel.id);
    if (!participants) {
      participants = new Set<string>();
      this.voiceChannels.set(channel.id, participants);
    }
    participants.add(player.token);
    this.activeVoiceByPlayer.set(player.token, channel.id);
    this.broadcastVoicePresence(channel.id);
    client.send("voice_config", { iceServers: this.iceServers });
    if (channel.kind === "direct") this.maybeReportContact(channel);
  }

  leaveVoice(client: CommunicationClient, rawPayload: unknown): void {
    const player = this.playerForClient(client);
    const parsed = VoiceLeaveSchema.safeParse(rawPayload);
    if (!player || !parsed.success) return;
    if (this.activeVoiceByPlayer.get(player.token) === parsed.data.channelId) {
      this.removeFromVoice(player.token, parsed.data.channelId);
    }
  }

  relayVoiceSignal(client: CommunicationClient, rawPayload: unknown): void {
    const sender = this.playerForClient(client);
    const parsed = VoiceSignalSchema.safeParse(rawPayload);
    if (!sender || !parsed.success) return;
    const payload: VoiceSignalInput = parsed.data;
    const channel = this.channels.get(payload.channelId);
    if (
      !channel ||
      !this.canAccess(sender, channel) ||
      !channel.memberIds.includes(payload.targetPlayerId) && channel.kind !== "global"
    ) {
      return;
    }
    if (this.activeVoiceByPlayer.get(sender.token) !== channel.id) return;
    if (this.activeVoiceByPlayer.get(payload.targetPlayerId) !== channel.id) return;
    if (!this.consumeRate(this.signalRate, sender.token, SIGNAL_RATE_WINDOW_MS, SIGNAL_RATE_LIMIT)) {
      return;
    }
    const targetClient = this.clientForPlayer(payload.targetPlayerId);
    targetClient?.send("voice_signal", {
      channelId: channel.id,
      fromPlayerId: sender.token,
      signal: payload.signal,
    });
  }

  removePlayer(playerId: string): void {
    const channelId = this.activeVoiceByPlayer.get(playerId);
    if (channelId) this.removeFromVoice(playerId, channelId);
    this.chatRate.delete(playerId);
    this.signalRate.delete(playerId);
  }

  dispose(): void {
    this.voiceChannels.clear();
    this.activeVoiceByPlayer.clear();
    this.chatRate.clear();
    this.signalRate.clear();
  }

  private playerForClient(client: CommunicationClient): CommunicationPlayer | undefined {
    return this.host
      .getPlayers()
      .find((player) => player.sessionId === client.sessionId && player.connected);
  }

  private clientForPlayer(playerId: string): CommunicationClient | undefined {
    const player = this.host.getPlayers().find((entry) => entry.token === playerId && entry.connected);
    if (!player) return undefined;
    return this.host.getClients().find((client) => client.sessionId === player.sessionId);
  }

  private canAccess(player: CommunicationPlayer, channel: CommunicationChannel): boolean {
    return channel.kind === "global" || channel.memberIds.includes(player.token);
  }

  private appendAndSend(channel: CommunicationChannel, message: CommunicationMessage): void {
    const history = this.messages.get(channel.id) ?? [];
    history.push(message);
    if (history.length > HISTORY_LIMIT) history.splice(0, history.length - HISTORY_LIMIT);
    this.messages.set(channel.id, history);
    for (const client of this.clientsForChannel(channel)) client.send("chat_msg", message);
  }

  private clientsForChannel(channel: CommunicationChannel): CommunicationClient[] {
    return this.host
      .getPlayers()
      .filter((player) => player.connected && this.canAccess(player, channel))
      .map((player) => this.clientForPlayer(player.token))
      .filter((client): client is CommunicationClient => Boolean(client));
  }

  private maybeReportContact(channel: CommunicationChannel): void {
    if (channel.memberIds.length !== 2) return;
    const [firstId, secondId] = channel.memberIds;
    if (this.host.areAllied?.(firstId, secondId)) return;
    const lastReport = this.lastIntelByChannel.get(channel.id) ?? -Infinity;
    if (this.now() - lastReport < INTEL_REPEAT_WINDOW_MS) return;
    this.lastIntelByChannel.set(channel.id, this.now());
    const first = this.host.getPlayers().find((player) => player.token === firstId);
    const second = this.host.getPlayers().find((player) => player.token === secondId);
    const globalChannel = this.channels.get(GLOBAL_CHANNEL_ID);
    if (!first || !second || !globalChannel) return;
    this.appendAndSend(globalChannel, {
      id: this.createId(),
      channelId: GLOBAL_CHANNEL_ID,
      kind: "intel",
      senderId: null,
      senderName: "Inteligência de Sinais",
      senderColor: null,
      senderAvatarUrl: null,
      text: `${first.name} está se comunicando com ${second.name}.`,
      createdAt: new Date(this.now()).toISOString(),
    });
  }

  private broadcastVoicePresence(channelId: string): void {
    const channel = this.channels.get(channelId);
    if (!channel) return;
    const presence: VoicePresence = {
      channelId,
      playerIds: [...(this.voiceChannels.get(channelId) ?? [])].sort((a, b) =>
        a.localeCompare(b)
      ),
    };
    for (const client of this.clientsForChannel(channel)) {
      client.send("voice_presence", presence);
    }
  }

  private removeFromVoice(playerId: string, channelId: string): void {
    this.activeVoiceByPlayer.delete(playerId);
    const participants = this.voiceChannels.get(channelId);
    participants?.delete(playerId);
    if (participants?.size === 0) this.voiceChannels.delete(channelId);
    this.broadcastVoicePresence(channelId);
  }

  private consumeRate(
    store: Map<string, number[]>,
    playerId: string,
    windowMs: number,
    limit: number
  ): boolean {
    const cutoff = this.now() - windowMs;
    const recent = (store.get(playerId) ?? []).filter((timestamp) => timestamp > cutoff);
    if (recent.length >= limit) {
      store.set(playerId, recent);
      return false;
    }
    recent.push(this.now());
    store.set(playerId, recent);
    return true;
  }
}

export function resolveIceServers(raw = process.env.WEBRTC_ICE_SERVERS): IceServerConfig[] {
  const fallback: IceServerConfig[] = [{ urls: "stun:stun.l.google.com:19302" }];
  if (!raw?.trim()) return fallback;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return fallback;
    const servers = parsed.filter((entry): entry is IceServerConfig => {
      if (!entry || typeof entry !== "object") return false;
      const candidate = entry as Record<string, unknown>;
      const validUrls =
        typeof candidate.urls === "string" ||
        (Array.isArray(candidate.urls) && candidate.urls.every((url) => typeof url === "string"));
      return (
        validUrls &&
        (candidate.username === undefined || typeof candidate.username === "string") &&
        (candidate.credential === undefined || typeof candidate.credential === "string")
      );
    });
    return servers.length > 0 ? servers : fallback;
  } catch {
    return fallback;
  }
}
