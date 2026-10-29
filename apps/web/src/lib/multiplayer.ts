export const HEGEMONIA_ROOM_NAME = "hegemonia";
export const RECONNECT_MAX_ATTEMPTS = 8;

const ROOM_CODE_PATTERN = /^[0-9A-F]{6}$/;
const TERMINAL_MATCHMAKING_CODES = new Set([4212, 4214]);

export interface BrowserLocation {
  protocol: string;
  hostname: string;
  host: string;
  port: string;
}

export interface RoomClient {
  create<T = unknown>(roomName: string, options?: Record<string, unknown>): Promise<T>;
  joinById<T = unknown>(roomId: string, options?: Record<string, unknown>): Promise<T>;
}

export interface ConnectRoomOptions {
  create: boolean;
  roomCode?: string;
  name: string;
  token: string;
}

export interface RetryOptions {
  maxAttempts?: number;
  shouldRetry?: (error: unknown) => boolean;
  onAttempt?: (attempt: number, maxAttempts: number) => void;
  delay?: (attempt: number) => number;
  sleep?: (milliseconds: number) => Promise<void>;
}

export class InvalidRoomCodeError extends Error {
  constructor() {
    super("Invalid room code");
    this.name = "InvalidRoomCodeError";
  }
}

export function normalizeRoomCode(value: string | undefined): string {
  const code = value?.trim().toUpperCase() ?? "";
  if (!ROOM_CODE_PATTERN.test(code)) throw new InvalidRoomCodeError();
  return code;
}

export function resolveWebSocketUrl(
  location: BrowserLocation,
  configuredUrl?: string
): string {
  if (configuredUrl) return configuredUrl;
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  if (location.port === "5173") {
    return `${protocol}//${location.hostname}:2567`;
  }
  return `${protocol}//${location.host}`;
}

export async function connectToRoom<T>(
  client: RoomClient,
  options: ConnectRoomOptions
): Promise<T> {
  const joinOptions = { name: options.name, token: options.token };
  if (options.create) {
    return client.create<T>(HEGEMONIA_ROOM_NAME, joinOptions);
  }
  return client.joinById<T>(normalizeRoomCode(options.roomCode), joinOptions);
}

export function isRecoverableConnectionError(error: unknown): boolean {
  if (error instanceof InvalidRoomCodeError) return false;
  if (typeof error === "object" && error && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "number" && TERMINAL_MATCHMAKING_CODES.has(code)) return false;
  }
  return true;
}

export function isRoomNotFoundError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error &&
    (error as { code?: unknown }).code === 4212;
}

export function reconnectDelay(attempt: number): number {
  return Math.min(5_000, 500 * 2 ** Math.max(0, attempt - 1));
}

export async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? RECONNECT_MAX_ATTEMPTS;
  const shouldRetry = options.shouldRetry ?? isRecoverableConnectionError;
  const delay = options.delay ?? reconnectDelay;
  const sleep = options.sleep ?? ((milliseconds: number) => new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  }));

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    options.onAttempt?.(attempt, maxAttempts);
    try {
      return await operation();
    } catch (error) {
      if (attempt === maxAttempts || !shouldRetry(error)) throw error;
      await sleep(delay(attempt));
    }
  }

  throw new Error("Retry policy exhausted");
}
