import type { Room } from "colyseus.js";
import {
  GLOBAL_CHANNEL_ID,
  directChannelId,
  type CommunicationChannel,
  type CommunicationMessage,
  type CommunicationSyncPayload,
  type IceServerConfig,
  type PlayerColor,
  type VoicePresence,
} from "@hegemonia/shared";
import { sound } from "../audio";
import { RadioManager, type RadioConnectionState, type RadioSignalPayload } from "./radio";

export interface CommunicationRosterPlayer {
  token: string;
  name: string;
  color: PlayerColor;
  isBot: boolean;
  connected: boolean;
  avatarUrl?: string | null;
}

export type ChatPanelSize = "normal" | "large" | "expanded";

export interface CommunicationSettings {
  chatSize: ChatPanelSize;
  showAvatars: boolean;
  showTimestamps: boolean;
  enterToSend: boolean;
  showIntel: boolean;
  notificationSound: boolean;
  pushToTalk: boolean;
  pushToTalkKey: string;
  voiceVolume: number;
  microphoneId: string;
}

const DEFAULT_SETTINGS: CommunicationSettings = {
  chatSize: "normal",
  showAvatars: true,
  showTimestamps: true,
  enterToSend: true,
  showIntel: true,
  notificationSound: true,
  pushToTalk: true,
  pushToTalkKey: "KeyV",
  voiceVolume: 0.8,
  microphoneId: "",
};

const SETTINGS_KEY = "hegemonia_communication_settings";

function loadSettings(): CommunicationSettings {
  if (typeof localStorage === "undefined") return { ...DEFAULT_SETTINGS };
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") as Partial<CommunicationSettings>;
    const validSizes: ChatPanelSize[] = ["normal", "large", "expanded"];
    return {
      chatSize:
        saved.chatSize && validSizes.includes(saved.chatSize)
          ? saved.chatSize
          : DEFAULT_SETTINGS.chatSize,
      showAvatars: saved.showAvatars ?? DEFAULT_SETTINGS.showAvatars,
      showTimestamps: saved.showTimestamps ?? DEFAULT_SETTINGS.showTimestamps,
      enterToSend: saved.enterToSend ?? DEFAULT_SETTINGS.enterToSend,
      showIntel: saved.showIntel ?? DEFAULT_SETTINGS.showIntel,
      notificationSound: saved.notificationSound ?? DEFAULT_SETTINGS.notificationSound,
      pushToTalk: saved.pushToTalk ?? DEFAULT_SETTINGS.pushToTalk,
      pushToTalkKey:
        typeof saved.pushToTalkKey === "string" && saved.pushToTalkKey.length < 32
          ? saved.pushToTalkKey
          : DEFAULT_SETTINGS.pushToTalkKey,
      voiceVolume:
        typeof saved.voiceVolume === "number"
          ? Math.max(0, Math.min(1, saved.voiceVolume))
          : DEFAULT_SETTINGS.voiceVolume,
      microphoneId: typeof saved.microphoneId === "string" ? saved.microphoneId : "",
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export class CommunicationsController {
  channels = $state<CommunicationChannel[]>([]);
  messages = $state<CommunicationMessage[]>([]);
  players = $state<CommunicationRosterPlayer[]>([]);
  openTabIds = $state<string[]>([GLOBAL_CHANNEL_ID]);
  activeChannelId = $state(GLOBAL_CHANNEL_ID);
  unreadByChannel = $state<Record<string, number>>({});
  drafts = $state<Record<string, string>>({});
  voicePresence = $state<Record<string, string[]>>({});
  activeVoiceChannelId = $state<string | null>(null);
  speakingByPlayer = $state<Record<string, boolean>>({});
  radioConnection = $state<RadioConnectionState>("disconnected");
  radioMuted = $state(false);
  settings = $state<CommunicationSettings>(loadSettings());
  error = $state("");
  microphones = $state<MediaDeviceInfo[]>([]);
  myPlayerId = $state("");

  activeMessages = $derived(
    this.messages.filter(
      (message) =>
        message.channelId === this.activeChannelId &&
        (this.settings.showIntel || message.kind !== "intel")
    )
  );
  totalUnread = $derived(
    Object.values(this.unreadByChannel).reduce((total, count) => total + count, 0)
  );

  private room: Room | null = null;
  private readonly radio = new RadioManager({
    onError: (message) => {
      this.error = message;
    },
    onSpeakingChange: (playerId, speaking) => {
      if (this.speakingByPlayer[playerId] === speaking) return;
      this.speakingByPlayer = { ...this.speakingByPlayer, [playerId]: speaking };
    },
    onConnectionChange: (state) => {
      this.radioConnection = state;
    },
  });

  attach(room: Room, myPlayerId: string, players: CommunicationRosterPlayer[]): void {
    this.detach();
    this.room = room;
    this.myPlayerId = myPlayerId;
    this.players = players;
    this.radio.attach(room, myPlayerId);
    this.applyRadioSettings();

    room.onMessage("comms_sync", (payload: CommunicationSyncPayload) => {
      const previousChannelIds = new Set(this.channels.map((channel) => channel.id));
      this.channels = payload.channels;
      this.messages = payload.messages;
      this.voicePresence = Object.fromEntries(
        payload.voice.map((presence) => [presence.channelId, presence.playerIds])
      );
      for (const channel of payload.channels) {
        if (channel.kind !== "global" && !previousChannelIds.has(channel.id)) {
          this.openTabIds = [...new Set([...this.openTabIds, channel.id])];
        }
      }
      if (!payload.channels.some((channel) => channel.id === this.activeChannelId)) {
        this.activeChannelId = GLOBAL_CHANNEL_ID;
      }
      const currentVoice = this.activeVoiceChannelId
        ? payload.voice.find((presence) => presence.channelId === this.activeVoiceChannelId)
        : null;
      if (currentVoice) this.radio.handlePresence(currentVoice);
    });

    room.onMessage("chat_msg", (message: CommunicationMessage) => {
      if (this.messages.some((entry) => entry.id === message.id)) return;
      this.messages = [...this.messages, message];
      if (!this.openTabIds.includes(message.channelId)) {
        this.openTabIds = [...this.openTabIds, message.channelId];
      }
      if (message.channelId !== this.activeChannelId && message.kind === "message") {
        this.unreadByChannel = {
          ...this.unreadByChannel,
          [message.channelId]: (this.unreadByChannel[message.channelId] ?? 0) + 1,
        };
      }
      if (
        message.kind === "message" &&
        message.senderId !== this.myPlayerId &&
        this.settings.notificationSound
      ) {
        sound.playCommsNotification();
      }
    });

    room.onMessage("voice_presence", (presence: VoicePresence) => {
      this.voicePresence = {
        ...this.voicePresence,
        [presence.channelId]: presence.playerIds,
      };
      this.radio.handlePresence(presence);
    });

    room.onMessage("voice_config", (payload: { iceServers: IceServerConfig[] }) => {
      this.radio.setIceServers(payload.iceServers);
    });

    room.onMessage("voice_signal", (payload: RadioSignalPayload) => {
      void this.radio.handleSignal(payload);
    });

    room.send("comms_sync", {});
  }

  setPlayers(players: CommunicationRosterPlayer[]): void {
    this.players = players;
  }

  setMyPlayerId(playerId: string): void {
    if (!playerId || playerId === this.myPlayerId) return;
    if (this.activeVoiceChannelId) this.leaveVoice();
    this.myPlayerId = playerId;
    if (this.room) {
      this.radio.attach(this.room, playerId);
      this.applyRadioSettings();
    }
  }

  detach(): void {
    this.radio.dispose();
    this.room = null;
    this.channels = [];
    this.messages = [];
    this.players = [];
    this.openTabIds = [GLOBAL_CHANNEL_ID];
    this.activeChannelId = GLOBAL_CHANNEL_ID;
    this.unreadByChannel = {};
    this.drafts = {};
    this.voicePresence = {};
    this.activeVoiceChannelId = null;
    this.speakingByPlayer = {};
    this.radioConnection = "disconnected";
    this.radioMuted = false;
    this.error = "";
    this.microphones = [];
    this.myPlayerId = "";
  }

  openDirect(playerId: string): void {
    if (!this.room || !this.myPlayerId || playerId === this.myPlayerId) return;
    const channelId = directChannelId(this.myPlayerId, playerId);
    this.openTabIds = [...new Set([...this.openTabIds, channelId])];
    this.selectChannel(channelId);
    this.room.send("open_direct", { playerId });
  }

  selectChannel(channelId: string): void {
    this.activeChannelId = channelId;
    this.unreadByChannel = { ...this.unreadByChannel, [channelId]: 0 };
  }

  closeChannel(channelId: string): void {
    if (channelId === GLOBAL_CHANNEL_ID || this.activeVoiceChannelId === channelId) return;
    this.openTabIds = this.openTabIds.filter((id) => id !== channelId);
    if (this.activeChannelId === channelId) this.selectChannel(GLOBAL_CHANNEL_ID);
  }

  send(text: string): void {
    const clean = text.trim();
    if (!this.room || !clean) return;
    this.room.send("chat", { channelId: this.activeChannelId, text: clean });
    this.drafts = { ...this.drafts, [this.activeChannelId]: "" };
  }

  setDraft(text: string): void {
    this.drafts = { ...this.drafts, [this.activeChannelId]: text };
  }

  async joinVoice(channelId: string): Promise<void> {
    this.error = "";
    this.applyRadioSettings();
    const joined = await this.radio.join(channelId);
    if (joined) {
      this.activeVoiceChannelId = channelId;
      void this.refreshMicrophones();
    }
  }

  leaveVoice(): void {
    this.radio.leave();
    this.activeVoiceChannelId = null;
    this.speakingByPlayer = {};
  }

  setTransmitting(transmitting: boolean): void {
    this.radio.setTransmitting(transmitting);
  }

  toggleRadioMute(): void {
    this.radioMuted = !this.radioMuted;
    this.radio.setMuted(this.radioMuted);
  }

  updateSettings(patch: Partial<CommunicationSettings>): void {
    this.settings = { ...this.settings, ...patch };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
    this.applyRadioSettings();
  }

  cycleChatSize(): void {
    const order: ChatPanelSize[] = ["normal", "large", "expanded"];
    const idx = order.indexOf(this.settings.chatSize);
    const next = order[(idx + 1) % order.length];
    this.updateSettings({ chatSize: next });
  }

  async refreshMicrophones(): Promise<void> {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      this.microphones = devices.filter((device) => device.kind === "audioinput");
    } catch {
      this.microphones = [];
    }
  }

  clearError(): void {
    this.error = "";
  }

  channelById(channelId: string): CommunicationChannel | undefined {
    return this.channels.find((channel) => channel.id === channelId);
  }

  playerById(playerId: string | null): CommunicationRosterPlayer | undefined {
    if (!playerId) return undefined;
    return this.players.find((player) => player.token === playerId);
  }

  otherPlayer(channel: CommunicationChannel): CommunicationRosterPlayer | undefined {
    const otherId = channel.memberIds.find((playerId) => playerId !== this.myPlayerId);
    return this.playerById(otherId ?? null);
  }

  channelTitle(channelId: string): string {
    const channel = this.channelById(channelId);
    if (!channel || channel.kind === "global") return "Global";
    if (channel.kind === "group") return channel.title ?? "Grupo de Comando";
    return this.otherPlayer(channel)?.name ?? "Frequência Direta";
  }

  private applyRadioSettings(): void {
    this.radio.configure({
      pushToTalk: this.settings.pushToTalk,
      outputVolume: this.settings.voiceVolume,
      microphoneId: this.settings.microphoneId,
    });
  }
}
