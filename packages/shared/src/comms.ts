import { z } from "zod";
import type { PlayerColor } from "./index.js";

export const GLOBAL_CHANNEL_ID = "global";

export const CommunicationChannelKindSchema = z.enum(["global", "direct", "group"]);
export type CommunicationChannelKind = z.infer<typeof CommunicationChannelKindSchema>;

export interface CommunicationChannel {
  id: string;
  kind: CommunicationChannelKind;
  memberIds: string[];
  title?: string;
  createdAt: string;
}

export const CommunicationMessageKindSchema = z.enum(["message", "intel"]);
export type CommunicationMessageKind = z.infer<typeof CommunicationMessageKindSchema>;

export interface CommunicationMessage {
  id: string;
  channelId: string;
  kind: CommunicationMessageKind;
  senderId: string | null;
  senderName: string;
  senderColor: PlayerColor | null;
  senderAvatarUrl: string | null;
  text: string;
  createdAt: string;
}

export interface VoicePresence {
  channelId: string;
  playerIds: string[];
}

export interface IceServerConfig {
  urls: string | string[];
  username?: string;
  credential?: string;
}

const ChannelIdSchema = z.string().trim().min(1).max(4096);
const PlayerIdSchema = z.string().trim().min(1).max(128);

export const ChatSendSchema = z.object({
  channelId: ChannelIdSchema,
  text: z.string().trim().min(1).max(240),
});
export type ChatSendInput = z.infer<typeof ChatSendSchema>;

export const DirectChannelOpenSchema = z.object({
  playerId: PlayerIdSchema,
});

export const VoiceJoinSchema = z.object({
  channelId: ChannelIdSchema,
});

export const VoiceLeaveSchema = z.object({
  channelId: ChannelIdSchema,
});

export const VoiceDescriptionSignalSchema = z.object({
  type: z.literal("description"),
  description: z.object({
    type: z.enum(["offer", "answer"]),
    sdp: z.string().min(1).max(65536),
  }),
});

export const VoiceCandidateSignalSchema = z.object({
  type: z.literal("candidate"),
  candidate: z.object({
    candidate: z.string().max(4096),
    sdpMid: z.string().max(128).nullable().optional(),
    sdpMLineIndex: z.number().int().min(0).max(65535).nullable().optional(),
    usernameFragment: z.string().max(256).nullable().optional(),
  }),
});

export const VoiceSignalSchema = z.object({
  channelId: ChannelIdSchema,
  targetPlayerId: PlayerIdSchema,
  signal: z.discriminatedUnion("type", [
    VoiceDescriptionSignalSchema,
    VoiceCandidateSignalSchema,
  ]),
});
export type VoiceSignalInput = z.infer<typeof VoiceSignalSchema>;

export interface CommunicationSyncPayload {
  channels: CommunicationChannel[];
  messages: CommunicationMessage[];
  voice: VoicePresence[];
}

export function directChannelId(firstPlayerId: string, secondPlayerId: string): string {
  return `direct:${[firstPlayerId, secondPlayerId]
    .sort((a, b) => a.localeCompare(b))
    .map(encodeURIComponent)
    .join(":")}`;
}
