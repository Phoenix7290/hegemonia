import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import type { AuthUser } from "@hegemonia/shared";
import sharp from "sharp";

const enabled = Boolean(process.env.TEST_DATABASE_URL);
const database = describe.skipIf(!enabled);
let server: Server;
let baseUrl: string;
let connection: typeof import("./connection.js");

beforeAll(async () => {
  if (!enabled) return;
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.WEB_ORIGIN = "http://localhost:5173";
  process.env.COOKIE_SECURE = "false";
  process.env.AVATAR_DIR = `/tmp/hegemonia-avatar-test-${process.pid}`;
  const [{ createApp }, db] = await Promise.all([import("./app.js"), import("./connection.js")]);
  connection = db;
  const app = await createApp();
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Porta de teste indisponível");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

beforeEach(async () => {
  if (enabled) await connection.query("TRUNCATE users, matches, seasons RESTART IDENTITY CASCADE");
});

afterAll(async () => {
  if (!enabled) return;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await connection.closeDatabase();
});

database("identidade e social HTTP", () => {
  it("registra com Argon2id, persiste somente hash da sessão e restaura a conta", async () => {
    const { response, body } = await request("/api/auth/register", "POST", registerInput("alice"));
    expect(response.status).toBe(201);
    expect(body.user.email).toBe("alice@example.com");
    const cookie = response.headers.get("set-cookie")!;
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    const token = /hegemonia_session=([^;]+)/.exec(cookie)![1];
    const stored = await connection.query(
      `SELECT password_hash, octet_length(token_hash) AS hash_length
       FROM users u JOIN auth_sessions s ON s.user_id = u.id WHERE username = 'alice'`
    );
    expect(stored.rows[0].password_hash).toMatch(/^\$argon2id\$/);
    expect(stored.rows[0].hash_length).toBe(32);
    expect(stored.rows[0].password_hash).not.toContain(token);

    await connection.query("UPDATE auth_sessions SET last_seen_at = now() - interval '20 minutes'");
    const me = await request("/api/auth/me", "GET", undefined, cookie);
    expect(me.body.user.username).toBe("alice");
    await request("/api/auth/logout", "POST", undefined, cookie);
    expect((await request("/api/auth/me", "GET", undefined, cookie)).body.user).toBeNull();
    const login = await request("/api/auth/login", "POST", { identifier: "ALICE", password: "correct-horse-123" });
    expect(login.response.status).toBe(200);
    expect(login.body.user.username).toBe("alice");
  });

  it("converte avatar para WebP quadrado e recusa origem não autorizada", async () => {
    const { response, cookie, body } = await register("avatar");
    const png = await sharp({ create: { width: 320, height: 180, channels: 3, background: "#224466" } }).png().toBuffer();
    const uploaded = await fetch(`${baseUrl}/api/profile/avatar`, {
      method: "PUT",
      headers: { Cookie: cookie, Origin: "http://localhost:5173", "Content-Type": "image/png" },
      body: png,
    });
    expect(uploaded.status).toBe(200);
    const { avatarUrl } = await uploaded.json();
    const image = await fetch(`${baseUrl}${avatarUrl}`);
    expect(image.status).toBe(200);
    expect(image.headers.get("content-type")).toBe("image/webp");
    const metadata = await sharp(Buffer.from(await image.arrayBuffer())).metadata();
    expect(metadata).toMatchObject({ width: 256, height: 256, format: "webp" });
    expect(body.user.avatarUrl).toBeNull();

    const rejected = await request("/api/profile", "PATCH", { bio: "não permitido" }, cookie, "https://malicious.example");
    expect(rejected.response.status).toBe(403);
  });

  it("aceita amizade, calcula mútuos e aplica privacidade com bloqueio dominante", async () => {
    const alice = await register("alice");
    const bob = await register("bob");
    const carol = await register("carol");
    await request("/api/profile", "PATCH", { profileVisibility: "friends" }, alice.cookie);
    expect((await request("/api/profiles/alice/stats", "GET", undefined, bob.cookie)).response.status).toBe(403);

    expect((await request(`/api/friends/${bob.body.user.id}/request`, "POST", undefined, alice.cookie)).response.status).toBe(204);
    expect((await request(`/api/friends/${alice.body.user.id}/accept`, "POST", undefined, bob.cookie)).response.status).toBe(204);
    expect((await request(`/api/friends/${carol.body.user.id}/request`, "POST", undefined, alice.cookie)).response.status).toBe(204);
    expect((await request(`/api/friends/${alice.body.user.id}/accept`, "POST", undefined, carol.cookie)).response.status).toBe(204);
    expect((await request(`/api/friends/${carol.body.user.id}/request`, "POST", undefined, bob.cookie)).response.status).toBe(204);
    expect((await request(`/api/friends/${bob.body.user.id}/accept`, "POST", undefined, carol.cookie)).response.status).toBe(204);

    const mutual = await request("/api/profiles/bob/mutual", "GET", undefined, alice.cookie);
    expect(mutual.body.friends).toHaveLength(1);
    expect(mutual.body.friends[0].username).toBe("carol");
    expect((await request("/api/profiles/alice/stats", "GET", undefined, bob.cookie)).response.status).toBe(200);

    await request(`/api/friends/${bob.body.user.id}/block`, "POST", undefined, alice.cookie);
    expect((await request("/api/profiles/alice/stats", "GET", undefined, bob.cookie)).response.status).toBe(403);
    const search = await request("/api/users/search?q=alice", "GET", undefined, bob.cookie);
    expect(search.body.users).toHaveLength(0);
    await request(`/api/friends/${bob.body.user.id}/block`, "DELETE", undefined, alice.cookie);
    const bobFriends = (await request("/api/friends", "GET", undefined, bob.cookie)).body.friends;
    expect(bobFriends.map((friend: { username: string }) => friend.username)).toEqual(["carol"]);
  });
});

function registerInput(username: string) {
  return { email: `${username}@example.com`, username, displayName: `General ${username}`, password: "correct-horse-123" };
}

async function register(username: string): Promise<{ response: Response; body: { user: AuthUser }; cookie: string }> {
  const { response, body } = await request("/api/auth/register", "POST", registerInput(username));
  const cookie = response.headers.get("set-cookie")!.split(";")[0];
  return { response, body, cookie };
}

async function request(path: string, method: string, body?: unknown, cookie?: string, origin = "http://localhost:5173") {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(cookie ? { Cookie: cookie } : {}),
      Origin: origin,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { response, body: response.status === 204 ? null : await response.json() };
}
