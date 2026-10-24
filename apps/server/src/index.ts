import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { HegemoniaRoom } from "./room.js";
import { getRecentMatches } from "./db.js";

const PORT = Number(process.env.PORT ?? 2567);
const HOST = process.env.HOST ?? "::"; // Dual-stack IPv6 + IPv4 by default

const app = express();
app.use(cors());
app.use(express.json({ limit: "64kb" }));

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "hegemonia-server", ipv6Ready: true });
});

app.get("/api/matches", (_req, res) => {
  res.json({ matches: getRecentMatches() });
});

// Serve built Svelte SPA in production
const staticDir = resolve(process.env.PUBLIC_DIR ?? "../web/dist");
if (existsSync(staticDir)) {
  app.use(express.static(staticDir));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api") || req.path.startsWith("/matchmake")) {
      return next();
    }
    res.sendFile(join(staticDir, "index.html"));
  });
}

const httpServer = createServer(app);
const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
});

gameServer.define("hegemonia", HegemoniaRoom).filterBy(["roomCode"]);

httpServer.listen(PORT, HOST, () => {
  console.log(`⚔️  Hegemonia Server listening on [${HOST}]:${PORT} (IPv6 + IPv4 Dual-Stack)`);
});
