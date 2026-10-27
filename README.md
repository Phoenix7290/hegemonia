# Hegemonia (Geopolitical Strategy Multiplayer Engine)

[![Release](https://img.shields.io/badge/release-v0.1.0--alpha-blue.svg)](https://github.com/ryanslx/hegemonia/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue.svg)](https://www.typescriptlang.org/)
[![Svelte 5](https://img.shields.io/badge/Svelte-5.x-orange.svg)](https://svelte.dev/)
[![Colyseus](https://img.shields.io/badge/Colyseus-0.15-red.svg)](https://colyseus.io/)

**Hegemonia** is an open-source, authoritative multiplayer geopolitical strategy game inspired by the timeless mechanics of *War (Grow)* and the immersive cartography and alt-history scope of grand strategy titles like *Hearts of Iron IV* and *Europa Universalis IV*.

Built with a modern web stack, Hegemonia runs fully in the browser with real-time WebSockets, cryptographically verifiable turn commitments, Natural Earth vector maps, and deep alt-history roleplay mechanics.

---

## Highlights & Features

- **Authoritative & Deterministic Game Engine**: Zero client-side authority. All moves, dice rolls, and combat resolutions are verified on the server using Mulberry32 PRNG and dual-round FNV-1a commitment hashes.
- **Natural Earth Vector Cartography**: Accurate global boundaries generated from Natural Earth Data (50m admin-0/1) via TopoJSON. No rectangular distortions; realistic coastlines and state lines.
- **Continuous Spherical Navigation**: Seamless zoom, pan, and desktop **WASD** camera controls with zero distortion or ocean artifacting.
- **Dual Visual Modes**:
  - **Cartographical**: High-contrast satellite relief terrain and elevation shading.
  - **Geopolitical**: Crisp diplomatic borders, region tints, and theater overlays.
- **44 Balanced Territories & Strategic Sea Lanes**:
  - Trans-Pacific Route: *California <-> Havaí <-> Japão & Nova Guiné*.
  - Southern Oceans: *Argentina <-> África do Sul & Austrália*.
  - Divided Asia Theaters: +2 Indo-Arábia, +2 Estepes & Sibéria, +3 Leste Asiático.
- **Classic + 10 Roleplay / Alt-History Ambitions**:
  - Play with classic objectives (continents, territory count, eliminating rivals) or Alt-History National Ambitions (*Doutrina Monroe*, *Pax Britannica*, *Mitteleuropa*, *Esfera de Co-Prosperidade*, *Califado Pan-Árabe*, *Herança Romana*, *Horda Dourada*, *União Pan-Africana*, etc.) assigned dynamically based on starting core homelands.
- **Competitive Fair-Play**:
  - Strict turn timers (120s limit with automatic fallback execution).
  - Round 1 deploy-only treaty (prevents turn-1 rushes).
  - Secret objective masking (opponents never see each other's hidden cards).

---

## Monorepo Architecture

```
hegemonia/
├── apps/
│   ├── server/           # Colyseus rooms, PostgreSQL repositories, migrations, Turn timers
│   └── web/              # Svelte 5 reactive frontend, SVG map engine, Sound FX
├── packages/
│   ├── shared/           # Zod action contracts, GameState interfaces, Types
│   ├── maps/             # 44-territory graph, TopoJSON data, Centroids, SVG paths
│   └── engine/           # Pure functional rules engine, combat sim, seeded PRNG
├── docs/
│   └── ROADMAP.md        # Feature roadmap & specifications for contributors
├── AGENTS.md             # Directives for AI coding assistants working on the repo
├── LICENSE               # MIT License
└── README.md
```

---

## Quickstart

### Prerequisites
- [Node.js](https://nodejs.org/) (v20+ recommended)
- [pnpm](https://pnpm.io/) (v9+)
- PostgreSQL 18, or Docker for the local database container

### Local Development

1. **Install dependencies and configure the environment:**
   ```bash
   pnpm install
   cp .env.example .env
   ```

2. **Start PostgreSQL and apply the migrations:**
   ```bash
   docker compose up -d postgres
   set -a; . ./.env; set +a
   pnpm --filter @hegemonia/server db:migrate
   ```

3. **Run tests and build all workspace projects:**
   ```bash
   pnpm test
   pnpm build
   ```

4. **Start the web and WebSocket development servers in separate terminals:**
   ```bash
   pnpm dev:server
   pnpm dev:web
   ```
   Open `http://localhost:5173` in your browser.

The schema includes persistent accounts, hashed sessions, profiles, avatars, friendships, blocks, badges, match history, seasonal ranked ratings, career statistics, and breakdowns by color, objective, map, and doctrine. Casual, LAN, guest, and bot matches remain supported; only eligible ranked matches affect the leaderboard.

Account sessions use an `HttpOnly`, `SameSite=Lax` cookie. Passwords are hashed with Argon2id and only SHA-256 session-token hashes are stored. Avatars are validated and converted to 256×256 WebP files. Set `COOKIE_SECURE=true` and the exact HTTPS `WEB_ORIGIN` in production; the HTTP-only local Docker default intentionally uses `COOKIE_SECURE=false`.

PostgreSQL integration tests are opt-in and destructive to their target database. Use a dedicated disposable database and an explicit `TEST_DATABASE_URL`:
```bash
export TEST_DATABASE_URL=postgresql://hegemonia:hegemonia@localhost:5432/hegemonia_test
pnpm --filter @hegemonia/server test:db
pnpm --filter @hegemonia/server test:identity
```

---

## Docker Deployment

Hegemonia can be packaged and run with PostgreSQL in production-ready containers:

```bash
# Build and run the stack in the background
docker compose up -d --build

# View logs
docker compose logs -f

# Stop the containers (keep database data)
docker compose down
```

The game server and web client will be available at `http://localhost:2567`. The app applies pending migrations on startup. Public routes include `/health`, `/api/matches`, `/api/leaderboard`, and `/api/profiles/:username`. Account routes live under `/api/auth`, `/api/profile`, `/api/friends`, and `/api/users/search`; private statistics use `/api/profiles/:username/stats` and enforce profile visibility.

Match history, snapshots, accounts, ratings, friendships, and statistics are persisted in the `postgres_data` Docker volume. Uploaded avatars persist separately in `avatar_data`. Change the default database credentials outside local development. The HTTP port can be customized by defining `PORT` in a `.env` file (see `.env.example`).

---

## Contributing & Roadmap

Hegemonia is built for open collaboration! If you or your AI agent want to contribute, check out:
- [docs/CRITICAL_TASKS.md](docs/CRITICAL_TASKS.md) for the immediate pre-roadmap stability and polish checklist (v0.1.x).
- [docs/ROADMAP.md](docs/ROADMAP.md) for the 12 upcoming major game expansions (Economy, Treaties, Capitals, Navy, Airforce, etc.).
- [AGENTS.md](AGENTS.md) for architectural guidelines and coding standards.

Pull requests and issues are welcome!

---

## License

This project is licensed under the [MIT License](LICENSE).
