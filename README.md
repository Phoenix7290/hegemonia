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
│   ├── server/           # Colyseus room handlers, SQLite persistence, Turn timers
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

### Local Development

1. **Install dependencies:**
   ```bash
   pnpm install
   ```

2. **Run tests across engine and map integrity:**
   ```bash
   pnpm test
   ```

3. **Build all packages and applications:**
   ```bash
   pnpm build
   ```

4. **Start local development server (web + WebSocket game server):**
   ```bash
   pnpm dev
   ```
   Open `http://localhost:5173` in your browser.

---

## Docker Deployment

Hegemonia can be packaged and run in a production-ready container:

```bash
docker compose up -d --build
```

The game server will be available at `http://localhost:3000`.

---

## Contributing & Roadmap

Hegemonia is built for open collaboration! If you or your AI agent want to contribute, check out:
- [docs/ROADMAP.md](docs/ROADMAP.md) for the 12 upcoming game expansions (Economy, Treaties, Capitals, Navy, Airforce, etc.).
- [AGENTS.md](AGENTS.md) for architectural guidelines and coding standards.

Pull requests and issues are welcome!

---

## License

This project is licensed under the [MIT License](LICENSE).
