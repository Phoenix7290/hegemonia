import { describe, expect, it } from "vitest";
import {
  GLOBAL_CHANNEL_ID,
  directChannelId,
  type CommunicationMessage,
  type CommunicationSyncPayload,
  type PlayerColor,
  type VoicePresence,
} from "@hegemonia/shared";
import {
  RoomCommunications,
  resolveIceServers,
  type CommunicationClient,
  type CommunicationPlayer,
} from "./communications.js";

interface SentMessage {
  type: string;
  payload: unknown;
}

class FakeClient implements CommunicationClient {
  readonly sent: SentMessage[] = [];

  constructor(readonly sessionId: string) {}

  send(type: string, payload: unknown): void {
    this.sent.push({ type, payload });
  }

  ofType<T>(type: string): T[] {
    return this.sent.filter((message) => message.type === type).map((message) => message.payload as T);
  }
}

function player(
  token: string,
  name: string,
  color: PlayerColor,
  overrides: Partial<CommunicationPlayer> = {}
): CommunicationPlayer {
  return {
    token,
    sessionId: `session-${token}`,
    name,
    color,
    isBot: false,
    connected: true,
    avatarUrl: `https://cdn.example.test/${token}.webp`,
    ...overrides,
  };
}

function harness(options: { allied?: boolean; now?: number } = {}) {
  let now = options.now ?? 1_000;
  let nextId = 0;
  const players = [
    player("alpha", "Alice", "blue"),
    player("beta", "Bruno", "red"),
    player("gamma", "Carla", "green"),
  ];
  const clients = players.map((entry) => new FakeClient(entry.sessionId));
  const [alpha, beta, gamma] = clients;
  const communications = new RoomCommunications(
    {
      getPlayers: () => players,
      getClients: () => clients,
      areAllied: options.allied ? () => true : undefined,
    },
    {
      now: () => now,
      createId: () => `message-${++nextId}`,
      iceServers: [{ urls: "stun:test.example:3478" }],
    }
  );

  return {
    communications,
    players,
    clients,
    alpha,
    beta,
    gamma,
    advance(milliseconds: number) {
      now += milliseconds;
    },
  };
}

function chatMessages(client: FakeClient): CommunicationMessage[] {
  return client.ofType<CommunicationMessage>("chat_msg");
}

function syncPayload(client: FakeClient): CommunicationSyncPayload {
  const payloads = client.ofType<CommunicationSyncPayload>("comms_sync");
  return payloads[payloads.length - 1];
}

describe("RoomCommunications", () => {
  it("usa um canal bilateral canônico e não vaza histórico ou mensagens para terceiros", () => {
    const { communications, alpha, beta, gamma } = harness();
    const openedByBeta = communications.openDirect(beta, { playerId: "alpha" });
    const expectedId = directChannelId("alpha", "beta");

    expect(openedByBeta?.id).toBe(expectedId);
    expect(openedByBeta?.memberIds).toEqual(["alpha", "beta"]);
    expect(directChannelId("beta", "alpha")).toBe(expectedId);

    communications.sendChat(beta, { channelId: expectedId, text: "Plano secreto" });
    expect(chatMessages(alpha).map((message) => message.text)).toContain("Plano secreto");
    expect(chatMessages(beta).map((message) => message.text)).toContain("Plano secreto");
    expect(chatMessages(gamma).map((message) => message.text)).not.toContain("Plano secreto");

    communications.sync(alpha);
    communications.sync(gamma);
    expect(syncPayload(alpha).channels.map((channel) => channel.id)).toContain(expectedId);
    expect(syncPayload(gamma).channels.map((channel) => channel.id)).not.toContain(expectedId);
    expect(syncPayload(gamma).messages.map((message) => message.text)).not.toContain("Plano secreto");
  });

  it("mantém o canal global público e preserva os metadados de identidade", () => {
    const { communications, alpha, beta, gamma } = harness();
    communications.sendChat(alpha, { channelId: GLOBAL_CHANNEL_ID, text: "Comando geral" });

    for (const client of [alpha, beta, gamma]) {
      expect(chatMessages(client)).toHaveLength(1);
      expect(chatMessages(client)[0]).toMatchObject({
        senderId: "alpha",
        senderName: "Alice",
        senderColor: "blue",
        senderAvatarUrl: "https://cdn.example.test/alpha.webp",
        text: "Comando geral",
      });
    }
  });

  it("recusa conversa e sinalização de quem não participa do canal direto", () => {
    const { communications, alpha, beta, gamma } = harness();
    const channel = communications.openDirect(alpha, { playerId: "beta" })!;

    communications.sendChat(gamma, { channelId: channel.id, text: "Intrusão" });
    expect(chatMessages(alpha).map((message) => message.text)).not.toContain("Intrusão");
    expect(chatMessages(beta).map((message) => message.text)).not.toContain("Intrusão");
    expect(gamma.ofType<{ message: string }>("error_msg").at(-1)?.message).toContain("indisponível");

    communications.relayVoiceSignal(gamma, {
      channelId: channel.id,
      targetPlayerId: "alpha",
      signal: { type: "description", description: { type: "offer", sdp: "intruso" } },
    });
    expect(alpha.ofType("voice_signal")).toHaveLength(0);
  });

  it("retransmite sinal somente entre participantes presentes na mesma linha", () => {
    const { communications, alpha, beta, gamma } = harness();
    const channel = communications.openDirect(alpha, { playerId: "beta" })!;
    communications.joinVoice(alpha, { channelId: channel.id });
    communications.joinVoice(beta, { channelId: channel.id });

    communications.relayVoiceSignal(alpha, {
      channelId: channel.id,
      targetPlayerId: "beta",
      signal: { type: "description", description: { type: "offer", sdp: "oferta-válida" } },
    });
    communications.relayVoiceSignal(alpha, {
      channelId: channel.id,
      targetPlayerId: "gamma",
      signal: { type: "description", description: { type: "offer", sdp: "alvo-intruso" } },
    });

    expect(beta.ofType<{ fromPlayerId: string; signal: { description: { sdp: string } } }>("voice_signal"))
      .toHaveLength(1);
    expect(beta.ofType<{ fromPlayerId: string; signal: { description: { sdp: string } } }>("voice_signal")[0])
      .toMatchObject({ fromPlayerId: "alpha", signal: { description: { sdp: "oferta-válida" } } });
    expect(gamma.ofType("voice_signal")).toHaveLength(0);
  });

  it("permite apenas uma linha por jogador e limpa presença ao trocar, sair ou desconectar", () => {
    const { communications, alpha, beta } = harness();
    const channel = communications.openDirect(alpha, { playerId: "beta" })!;
    communications.joinVoice(alpha, { channelId: GLOBAL_CHANNEL_ID });
    communications.joinVoice(beta, { channelId: GLOBAL_CHANNEL_ID });

    communications.joinVoice(alpha, { channelId: channel.id });
    const globalAfterSwitch = beta
      .ofType<VoicePresence>("voice_presence")
      .filter((presence) => presence.channelId === GLOBAL_CHANNEL_ID)
      .at(-1);
    expect(globalAfterSwitch).toEqual({ channelId: GLOBAL_CHANNEL_ID, playerIds: ["beta"] });

    communications.joinVoice(beta, { channelId: channel.id });
    const bothOnDirect = alpha.ofType<VoicePresence>("voice_presence").at(-1);
    expect(bothOnDirect).toEqual({ channelId: channel.id, playerIds: ["alpha", "beta"] });

    communications.leaveVoice(alpha, { channelId: channel.id });
    expect(beta.ofType<VoicePresence>("voice_presence").at(-1)).toEqual({
      channelId: channel.id,
      playerIds: ["beta"],
    });

    communications.removePlayer("beta");
    expect(beta.ofType<VoicePresence>("voice_presence").at(-1)).toEqual({
      channelId: channel.id,
      playerIds: [],
    });
  });

  it("publica somente o contato entre rivais, com antispam e sem conteúdo privado", () => {
    const { communications, alpha, gamma, advance } = harness();
    const channel = communications.openDirect(alpha, { playerId: "beta" })!;

    communications.sendChat(alpha, { channelId: channel.id, text: "Ataque ao amanhecer" });
    const firstAlerts = chatMessages(gamma).filter((message) => message.kind === "intel");
    expect(firstAlerts).toHaveLength(1);
    expect(firstAlerts[0].text).toBe("Alice está se comunicando com Bruno.");
    expect(firstAlerts[0].text).not.toContain("Ataque");

    communications.sendChat(alpha, { channelId: channel.id, text: "Mantenha sigilo" });
    expect(chatMessages(gamma).filter((message) => message.kind === "intel")).toHaveLength(1);

    advance(46_000);
    communications.sendChat(alpha, { channelId: channel.id, text: "Nova janela" });
    expect(chatMessages(gamma).filter((message) => message.kind === "intel")).toHaveLength(2);
  });

  it("não gera alerta de rivalidade para aliados", () => {
    const { communications, alpha, gamma } = harness({ allied: true });
    const channel = communications.openDirect(alpha, { playerId: "beta" })!;
    communications.sendChat(alpha, { channelId: channel.id, text: "Coordenação aliada" });
    expect(chatMessages(gamma).filter((message) => message.kind === "intel")).toHaveLength(0);
  });

  it("limita o histórico por canal a 100 mensagens", () => {
    const { communications, alpha, advance } = harness();
    for (let index = 0; index < 105; index++) {
      communications.sendChat(alpha, { channelId: GLOBAL_CHANNEL_ID, text: `Mensagem ${index}` });
      advance(2_001);
    }
    communications.sync(alpha);
    const messages = syncPayload(alpha).messages;
    expect(messages).toHaveLength(100);
    expect(messages[0].text).toBe("Mensagem 5");
    expect(messages.at(-1)?.text).toBe("Mensagem 104");
  });
});

describe("resolveIceServers", () => {
  it("oferece STUN por padrão e aceita configuração STUN/TURN válida", () => {
    expect(resolveIceServers(undefined)).toEqual([{ urls: "stun:stun.l.google.com:19302" }]);
    const configured = [{ urls: ["stun:stun.example:3478"], username: "radio", credential: "secret" }];
    expect(resolveIceServers(JSON.stringify(configured))).toEqual(configured);
    expect(resolveIceServers("not-json")).toEqual([{ urls: "stun:stun.l.google.com:19302" }]);
  });
});
