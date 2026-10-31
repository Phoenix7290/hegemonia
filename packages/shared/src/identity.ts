import { z } from "zod";

export const ProfileVisibilitySchema = z.enum(["public", "friends", "private"]);
export type ProfileVisibility = z.infer<typeof ProfileVisibilitySchema>;

export const UsernameSchema = z
  .string()
  .trim()
  .min(3, "O nome de usuário precisa ter ao menos 3 caracteres.")
  .max(24, "O nome de usuário pode ter no máximo 24 caracteres.")
  .regex(/^[A-Za-z0-9_]+$/, "Use apenas letras, números e sublinhado no nome de usuário.");

export const DisplayNameSchema = z
  .string()
  .trim()
  .min(1, "Informe um nome de exibição.")
  .max(32, "O nome de exibição pode ter no máximo 32 caracteres.")
  .refine((value) => !/[\u0000-\u001f\u007f]/.test(value), "O nome contém caracteres inválidos.");

export const PasswordSchema = z
  .string()
  .min(12, "A senha precisa ter ao menos 12 caracteres.")
  .max(128, "A senha pode ter no máximo 128 caracteres.");

export const RegisterSchema = z.object({
  email: z.string().trim().toLowerCase().email("Informe um e-mail válido.").max(254),
  username: UsernameSchema,
  displayName: DisplayNameSchema,
  password: PasswordSchema,
});

export const LoginSchema = z.object({
  identifier: z.string().trim().min(1, "Informe seu e-mail ou nome de usuário.").max(254),
  password: z.string().min(1, "Informe sua senha.").max(128),
});

export const ProfileUpdateSchema = z
  .object({
    displayName: DisplayNameSchema.optional(),
    bio: z.string().trim().max(500, "A biografia pode ter no máximo 500 caracteres.").optional(),
    profileVisibility: ProfileVisibilitySchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "Nenhuma alteração foi informada.");

export const UserSearchSchema = z.object({
  q: z.string().trim().min(2, "Digite ao menos 2 caracteres.").max(64),
});

export interface AuthUser {
  id: string;
  email: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string;
  profileVisibility: ProfileVisibility;
  role: "user" | "moderator" | "admin";
  totalXp: number;
  level: number;
  createdAt: string;
}

export interface PublicProfile {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string | null;
  totalXp: number;
  level: number;
  createdAt: string;
  lastSeenAt: string | null;
  isSelf: boolean;
  canViewStats: boolean;
  relationship: "self" | "friends" | "incoming" | "outgoing" | "blocked" | "none";
  mutualFriends: number;
}

export interface MatchXpGrant {
  competitionMode: "custom" | "casual" | "ranked";
  baseXp: number;
  bonusXp: number;
  totalXpEarned: number;
  levelBefore: number;
  levelAfter: number;
  didLevelUp: boolean;
  breakdown: {
    base: number;
    winBonus: number;
    placementBonus: number;
  };
}

export interface Badge {
  id: string;
  slug: string;
  name: string;
  description: string;
  icon: string;
  category: "victory" | "career" | "streak";
  threshold: number;
  awardedAt: string | null;
}

export interface FriendSummary {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  lastSeenAt: string | null;
  friendsSince?: string;
  requestedAt?: string;
  requesterId?: string;
}

export interface PlayerStats {
  career: {
    userId: string;
    username: string;
    displayName: string;
    matchesPlayed: number;
    wins: number;
    losses: number;
    draws: number;
    winRate: number | null;
    averagePlacement: number | null;
    currentWinStreak: number;
  } | null;
  byColor: StatBreakdown<"color">[];
  byObjective: StatBreakdown<"objectiveId">[];
  byMap: Array<StatBreakdown<"mapId"> & { gameMode: string }>;
  byDoctrine: StatBreakdown<"doctrineId">[];
  recentRatingChanges: Array<{
    matchId: string;
    previousScore: number;
    newScore: number;
    scoreDelta: number;
    result: string;
    createdAt: string;
  }>;
}

export type StatBreakdown<K extends string> = { [P in K]: string | null } & {
  matchesPlayed: number;
  wins: number;
  winRate: number | null;
};

export interface LeaderboardRow {
  rank: number;
  userId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  score: number;
  matchesPlayed: number;
  wins: number;
  winRate: number | null;
  updatedAt: string;
}

export type RegisterInput = z.infer<typeof RegisterSchema>;
export type LoginInput = z.infer<typeof LoginSchema>;
export type ProfileUpdateInput = z.infer<typeof ProfileUpdateSchema>;
