# Directives for AI Agents Working on Hegemonia (AGENTS.md)

Welcome, AI pair programmer! When contributing to or refactoring the **Hegemonia** codebase, adhere strictly to the following architectural laws and design principles.

---

## 1. Monorepo Organization & Boundary Separation

- **`packages/shared`**:
  - The single source of truth for all types, interfaces, and Zod schemas (`GameState`, `PlayerState`, `ActionSchema`, etc.).
  - Must remain dependency-lean (only `zod`). Never import engine, maps, server, or web code here.

- **`packages/engine` (Pure Authoritative Rules)**:
  - **Zero Network / Zero DOM**: Must NOT import Node.js built-ins (`fs`, `net`, `http`), browser APIs (`window`, `document`), or Colyseus classes.
  - **100% Deterministic**: All randomness MUST pass through the seeded PRNG (`createSeededRng(seed)` from `./rng.ts`). Never call `Math.random()`.
  - **State Masking**: `createPlayerView(state, playerId)` MUST ALWAYS mask opponents' `objective` and `cards`. Secret objectives can never leak over the network.

- **`packages/maps` (Cartography & Graph Definitions)**:
  - Contains territories, adjacency neighbors, continent definitions, Asia sub-regions, and SVG vector paths generated from Natural Earth TopoJSON.
  - Symmetrical borders: If territory $A$ lists territory $B$ as a neighbor, $B$ MUST list $A$.
  - Clean polygons: All SVG paths must have realistic bounded dimensions ($w < 450, h < 300$ on the $1200 \times 620$ canvas) to prevent inverted spherical polygons from filling the oceans.

- **`apps/server` (Colyseus & PostgreSQL Persistence)**:
  - Authoritative room controller (`room.ts`). Validates client messages using Zod schemas from `@hegemonia/shared`, applies actions via `applyAction` from `@hegemonia/engine`, and dispatches player views via `createPlayerView`.
  - Manages the 120s turn timer with automated timeouts (auto-trade mandatory 5-card hands, auto-deploy remaining reinforcements, and advance the turn).
  - Uses PostgreSQL 18 through `pg`; SQL migrations live in `apps/server/migrations`. Never reintroduce SQLite or a second source of persistent state.
  - Match events, snapshots, current state, results, and rating changes must commit atomically. Only publish a new authoritative state after its transaction commits.
  - Queryable player, match, result, and rating data belongs in relational columns. Reserve `jsonb` for versioned configuration, actions, and state snapshots.
  - Run `pnpm --filter @hegemonia/server db:migrate` before local development. Database integration tests require an explicit disposable `TEST_DATABASE_URL` and truncate its data; never point them at development or production.

- **`apps/web` (Svelte 5 Reactive Frontend)**:
  - Uses Svelte 5 runes (`$state`, `$derived`, `$props`).
  - Keep styling consistent: Tailwind CSS, modern dark military theme, clean typography.
  - **Zero Emojis**: Maintain a serious, immersive geopolitical wargame aesthetic. Use SVG icons, military insignias, or national flags.

---

## 2. Testing & Quality Requirements

Before submitting changes or committing:
1. Run `pnpm test` to verify map integrity, adjacency symmetry, card escalation, and victory conditions.
2. Run `pnpm build` across all workspace projects to catch any TypeScript errors.
3. Every new game rule or victory condition MUST have a corresponding unit test in `packages/engine/src/engine.test.ts`.

---

## 3. Collaborative Feature Expansion Guidelines

When implementing features from `docs/ROADMAP.md` (e.g., War Economy, Diplomatic Treaties, Command Capitals, 3-Tier Combat Units):
1. **Define Schema First**: Add the action types and payload interfaces to `packages/shared/src/index.ts`.
2. **Pure Reducer Implementation**: Add the state transition logic to `packages/engine/src/index.ts` within `applyAction`.
3. **Unit Tests First/Concurrent**: Add comprehensive test scenarios in `packages/engine/src/engine.test.ts`.
4. **Server Integration**: Hook up action dispatching in `apps/server/src/room.ts`.
5. **UI Component**: Build intuitive, clean Svelte 5 components in `apps/web/src/components/`.

---

## 4. Git & Code Style

- Write commits, pull request descriptions, and code comments in **English**.
- In-game UI, region names, and player logs should support Brazilian Portuguese (`namePt`, `descriptionPt`) with English fallbacks.
- Keep functions modular, pure, and well-typed. Avoid `any` types wherever possible.

---

## 5. Internationalization (i18n) Architecture

- **Core & Runtime**:
  - Implemented in `apps/web/src/i18n/` using pure Svelte 5 runes (`$state`, `$derived`) and native browser `Intl` caches. No heavy external runtime i18n dependencies.
  - Active locale is stored reactively on `i18n.locale`, automatically synchronizing with `<html lang="...">` and persisted in `localStorage`.
  - Default locale is `pt-BR` with full parity in `en`.

- **Namespace Separation**:
  - Translation catalogs are organized into 6 modular namespaces:
    - `common`: shared buttons, controls, states, time/turn interpolations.
    - `game`: combat phases, supply cards, division presets, capitals, victory stats, factions & doctrines.
    - `map`: 44 territories, 6 continents, Asian subregions, 24 classic & roleplay objectives, map modes.
    - `social`: topbar, account menu, authentication dialog, profiles, friends, leaderboard, badges.
    - `comms`: transmission settings, channel titles, radio console, PTT, intel intrigue alerts.
    - `errors`: client/server error codes, validation, room, auth, and social error messages.

- **Dynamic Content Resolvers**:
  - Entity names (territories, continents, objectives, factions, badges) MUST be resolved via helper functions in `apps/web/src/i18n/content.svelte.ts` (`getTerritoryName`, `getContinentName`, `getObjectiveDescription`, `getFactionName`, etc.).
  - Do NOT hardcode UI text strings or bypass the resolvers.
  - User-generated content (chat messages, custom usernames, user bios) MUST NEVER be passed through translation functions.

- **Adding a New Locale**:
  1. Create `apps/web/src/i18n/locales/<locale>/` containing the 6 namespace catalogs.
  2. Maintain 100% key parity with `pt-BR` and `en` (enforced by `i18n.test.ts`).
  3. Register the locale in `apps/web/src/i18n/registry.ts` under `SUPPORTED_LOCALES` and `catalogs`.

