import { createServer } from "node:http";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { HegemoniaRoom } from "./room.js";
import { checkDatabase, closeDatabase } from "./db.js";
import { runMigrations } from "./migrate.js";
import { createApp } from "./app.js";

const PORT = Number(process.env.PORT ?? 2567);
const HOST = process.env.HOST ?? "::";
const app = await createApp();
const httpServer = createServer(app);
const gameServer = new Server({ transport: new WebSocketTransport({ server: httpServer }) });

gameServer.define("hegemonia", HegemoniaRoom).filterBy(["roomCode"]);

await checkDatabase();
await runMigrations();
httpServer.listen(PORT, HOST, () => {
  console.log(`Hegemonia Server listening on [${HOST}]:${PORT} (IPv6 + IPv4 Dual-Stack)`);
});

let shuttingDown = false;
async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  httpServer.close();
  await closeDatabase();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
