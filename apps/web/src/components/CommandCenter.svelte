<script lang="ts">
  import type { LeaderboardRow, PlayerColor } from "@hegemonia/shared";
  import { api, navigate } from "../lib/api";
  import { auth } from "../lib/auth.svelte";
  import type { CommunicationsController } from "../lib/communications.svelte";
  import { t } from "../i18n/index.svelte";
  import { getFactionName, getFactionDoctrine } from "../i18n/content.svelte";
  import Avatar from "./Avatar.svelte";
  import CommunicationsCenter from "./CommunicationsCenter.svelte";
  import FactionFlag from "./FactionFlag.svelte";
  import Icon from "./Icon.svelte";

  export interface LobbyPlayerView {
    token: string;
    name: string;
    color: PlayerColor;
    isHost: boolean;
    isBot: boolean;
    connected: boolean;
    userId?: string | null;
    username?: string | null;
    avatarUrl?: string | null;
  }

  let {
    roomStatus,
    playerName = $bindable(),
    roomCodeInput = $bindable(),
    roomCode,
    myPlayerId,
    lobbyPlayers,
    communications,
    connecting,
    onCreateRoom,
    onJoinRoom,
    onLeaveRoom,
    onChooseColor,
    onAddBot,
    onRemoveBot,
    onStartGame,
  }: {
    roomStatus: "disconnected" | "lobby";
    playerName: string;
    roomCodeInput: string;
    roomCode: string;
    myPlayerId: string | null;
    lobbyPlayers: LobbyPlayerView[];
    communications: CommunicationsController;
    connecting: boolean;
    onCreateRoom: () => void;
    onJoinRoom: () => void;
    onLeaveRoom: () => void;
    onChooseColor: (color: PlayerColor) => void;
    onAddBot: () => void;
    onRemoveBot: (token: string) => void;
    onStartGame: () => void;
  } = $props();

  const ALL_COLORS: PlayerColor[] = ["blue", "red", "green", "yellow", "black", "white"];

  let topCommanders = $state<LeaderboardRow[]>([]);
  let copiedCode = $state(false);

  $effect(() => {
    api<{ leaderboard: LeaderboardRow[] }>("/api/leaderboard?limit=5")
      .then((res) => {
        topCommanders = res.leaderboard.slice(0, 5);
      })
      .catch(() => {
        topCommanders = [];
      });
  });

  let myLobbyEntry = $derived(lobbyPlayers.find((p) => p.token === myPlayerId) ?? null);
  let amIHost = $derived(Boolean(myLobbyEntry?.isHost));
  let emptySlotsCount = $derived(Math.max(0, 6 - lobbyPlayers.length));

  function copyRoomCode() {
    if (!roomCode) return;
    navigator.clipboard?.writeText(roomCode);
    copiedCode = true;
    setTimeout(() => {
      copiedCode = false;
    }, 2000);
  }
</script>

<div class="command-center-backdrop">
  {#if roomStatus === "disconnected"}
    <div class="command-deck-container">
      <!-- HERO HEADER WITH OFFICIAL EMBLEM LOGO -->
      <header class="deck-hero">
        <img
          src="/hegemonia-logo.webp"
          alt="Hegemonia — Global War Emblem"
          class="hero-emblem-img"
        />
        <p class="hero-tagline">
          {t("deck_hero_tagline")}
        </p>
      </header>

      <div class="deck-grid">
        <!-- LEFT COLUMN: CAMPAIGN OPERATIONS & DEPLOYMENT -->
        <section class="deck-card primary-ops-card">
          <div class="card-corner tl"></div>
          <div class="card-corner tr"></div>
          <div class="card-corner bl"></div>
          <div class="card-corner br"></div>

          <div class="ops-header">
            <span class="eyebrow">{t("deck_ops_eyebrow")}</span>
            <h2>{t("deck_ops_title")}</h2>
          </div>

          <!-- Commander Identity Box -->
          {#if auth.user}
            <div class="commander-id-card authenticated">
              <Avatar name={auth.user.displayName} avatarUrl={auth.user.avatarUrl} size="medium" />
              <div class="cid-meta">
                <div class="cid-badges">
                  <span class="status-pill verified"><Icon name="shield" size={12} /> {t("deck_verified_account")}</span>
                  <span class="status-pill ranked">{t("deck_ranked_active")}</span>
                </div>
                <strong>{auth.user.displayName}</strong>
                <small>@{auth.user.username}</small>
              </div>
              <button
                class="outline-button cid-action"
                onclick={() => navigate(`/profile/${auth.user!.username}`)}
              >
                {t("deck_btn_dossier")}
              </button>
            </div>
          {:else}
            <div class="commander-id-card guest">
              <div class="guest-field">
                <label for="cmd-name">{t("deck_guest_label")}</label>
                <input
                  id="cmd-name"
                  bind:value={playerName}
                  maxlength="24"
                  placeholder={t("deck_guest_placeholder")}
                />
              </div>
              <div class="guest-auth-bar">
                <span>{t("deck_guest_upsell")}</span>
                <button class="text-gold-btn" onclick={() => (auth.dialogOpen = true)}>
                  <Icon name="shield" size={14} /> {t("deck_guest_btn_auth")}
                </button>
              </div>
            </div>
          {/if}

          <!-- Create New War Room CTA -->
          <div class="ops-action-block">
            <button class="launch-campaign-btn" disabled={connecting} onclick={onCreateRoom}>
              <div class="launch-icon-box">
                <Icon name="swords" size={22} />
              </div>
              <div class="launch-text">
                <strong>{connecting ? t("deck_btn_creating_room") : t("deck_btn_create_room")}</strong>
                <small>{t("deck_create_room_sub")}</small>
              </div>
            </button>
          </div>

          <div class="tactical-divider">
            <span>{t("deck_or_join")}</span>
          </div>

          <!-- Join Existing Room by Code -->
          <div class="join-operation-box">
            <div class="code-input-wrap">
              <span class="code-prefix">OP //</span>
              <input
                bind:value={roomCodeInput}
                maxlength="6"
                placeholder={t("deck_room_code_placeholder")}
                onkeydown={(e) => e.key === "Enter" && onJoinRoom()}
              />
            </div>
            <button
              class="join-btn"
              disabled={connecting || !roomCodeInput.trim()}
              onclick={onJoinRoom}
            >
              <Icon name="compass" size={16} /> {t("deck_btn_join")}
            </button>
          </div>
        </section>

        <!-- RIGHT COLUMN: STRATEGIC BRIEFING & LIVE LEADERBOARD -->
        <div class="deck-side-column">
          <!-- Theatre Specifications -->
          <section class="deck-card intel-card">
            <div class="ops-header compact">
              <span class="eyebrow">{t("deck_params_eyebrow")}</span>
              <h3>{t("deck_params_title")}</h3>
            </div>

            <div class="intel-specs-grid">
              <div class="spec-item">
                <span class="spec-icon"><Icon name="globe" size={18} /></span>
                <div>
                  <strong>{t("deck_spec_territories_title")}</strong>
                  <small>{t("deck_spec_territories_desc")}</small>
                </div>
              </div>

              <div class="spec-item">
                <span class="spec-icon"><Icon name="target" size={18} /></span>
                <div>
                  <strong>{t("deck_spec_objectives_title")}</strong>
                  <small>{t("deck_spec_objectives_desc")}</small>
                </div>
              </div>

              <div class="spec-item">
                <span class="spec-icon"><Icon name="flag" size={18} /></span>
                <div>
                  <strong>{t("deck_spec_asia_title")}</strong>
                  <small>{t("deck_spec_asia_desc")}</small>
                </div>
              </div>

              <div class="spec-item">
                <span class="spec-icon"><Icon name="lock" size={18} /></span>
                <div>
                  <strong>{t("deck_spec_audit_title")}</strong>
                  <small>{t("deck_spec_audit_desc")}</small>
                </div>
              </div>
            </div>
          </section>

          <!-- Top Commanders Mini Leaderboard -->
          <section class="deck-card mini-rank-card">
            <div class="ops-header compact row-spread">
              <div>
                <span class="eyebrow">{t("deck_honor_eyebrow")}</span>
                <h3>{t("deck_honor_title")}</h3>
              </div>
              <button class="text-gold-btn" onclick={() => navigate("/leaderboard")}>
                <span>{t("deck_btn_full_ranking")}</span>
                <Icon name="chevron-right" size={14} />
              </button>
            </div>

            {#if topCommanders.length > 0}
              <div class="mini-rank-list">
                {#each topCommanders as cmd}
                  <button
                    class="mini-rank-row"
                    onclick={() => navigate(`/profile/${cmd.username}`)}
                  >
                    <span class="m-rank">#{cmd.rank}</span>
                    <Avatar name={cmd.displayName} avatarUrl={cmd.avatarUrl} size="small" />
                    <div class="m-info">
                      <strong>{cmd.displayName}</strong>
                      <small>{t("deck_wins_matches", { wins: cmd.wins, matches: cmd.matchesPlayed })}</small>
                    </div>
                    <strong class="m-score">{t("deck_pts", { score: cmd.score })}</strong>
                  </button>
                {/each}
              </div>
            {:else}
              <div class="mini-rank-empty">
                <p>{t("deck_honor_empty")}</p>
                <div class="mini-rank-Quicklinks">
                  <button class="outline-button" onclick={() => navigate("/leaderboard")}>
                    <Icon name="rank" size={14} /> {t("nav_leaderboard")}
                  </button>
                  <button class="outline-button" onclick={() => navigate("/friends")}>
                    <Icon name="users" size={14} /> {t("nav_allies")}
                  </button>
                </div>
              </div>
            {/if}
          </section>
        </div>
      </div>
    </div>

  {:else if roomStatus === "lobby"}
    <!-- PRE-GAME BRIEFING WAR ROOM -->
    <div class="briefing-room-container">
      <section class="deck-card briefing-card">
        <div class="card-corner tl"></div>
        <div class="card-corner tr"></div>
        <div class="card-corner bl"></div>
        <div class="card-corner br"></div>

        <!-- Briefing Top Header -->
        <header class="briefing-header">
          <div class="briefing-title-group">
            <img src="/hegemonia-logo.webp" alt="Hegemonia" class="briefing-mini-logo" />
            <div>
              <span class="eyebrow">{t("lobby_eyebrow")}</span>
              <div class="op-code-row">
                <h2>{t("lobby_op_label")} <span class="op-code-val">{roomCode}</span></h2>
                <button class="copy-code-btn" onclick={copyRoomCode} title={t("lobby_btn_copy_code")}>
                  <Icon name={copiedCode ? "check" : "copy"} size={14} />
                  {copiedCode ? t("lobby_btn_copied_code") : t("lobby_btn_copy_code")}
                </button>
              </div>
            </div>
          </div>

          <div class="briefing-header-right">
            <div class="capacity-pill">
              <Icon name="users" size={15} />
              <span><strong>{lobbyPlayers.length}</strong> / 6 {t("commanders").toUpperCase()}</span>
            </div>
            <button class="leave-room-btn" onclick={onLeaveRoom}>
              <Icon name="back" size={15} /> {t("lobby_btn_leave")}
            </button>
          </div>
        </header>

        <div class="briefing-body-grid">
          <!-- LEFT: 6-SLOT COMMAND ROSTER & FACTION SELECTION -->
          <div class="briefing-main-col">
            <div class="roster-block">
              <div class="section-subhead">
                <span>{t("lobby_roster_title")}</span>
                <small>{t("lobby_roster_sub")}</small>
              </div>

              <div class="slots-grid">
                {#each lobbyPlayers as p}
                  <div
                    class="slot-card occupied"
                    class:is-me={p.token === myPlayerId}
                    style="border-left-color: var(--faction-{p.color}, #eab308);"
                  >
                    <FactionFlag color={p.color} width={30} height={19} />
                    <Avatar name={p.name} avatarUrl={p.avatarUrl ?? null} size="small" />

                    <div class="slot-info">
                      <div class="slot-name-row">
                        <strong>{p.name}</strong>
                        {#if p.token === myPlayerId}
                          <span class="me-tag">{t("you")}</span>
                        {/if}
                      </div>
                      <small>
                        {getFactionName(p.color)}
                        {#if p.username} • @{p.username}{/if}
                      </small>
                    </div>

                    <div class="slot-badges">
                      {#if p.isHost}
                        <span class="role-badge host"><Icon name="crown" size={12} /> {t("lobby_role_host")}</span>
                      {:else if p.isBot}
                        <span class="role-badge bot"><Icon name="bot" size={12} /> {t("lobby_role_bot")}</span>
                      {:else}
                        <span class="role-badge human">{t("lobby_role_human")}</span>
                      {/if}

                      {#if p.isBot && amIHost}
                        <button
                          class="remove-bot-btn"
                          onclick={() => onRemoveBot(p.token)}
                          title={t("lobby_btn_remove_bot")}
                        >
                          <Icon name="close" size={14} />
                        </button>
                      {/if}
                    </div>
                  </div>
                {/each}

                {#each Array(emptySlotsCount) as _, idx}
                  <div class="slot-card empty-slot">
                    <div class="empty-slot-left">
                      <span class="empty-slot-num">0{lobbyPlayers.length + idx + 1}</span>
                      <div>
                        <strong>{t("lobby_slot_available")}</strong>
                        <small>{t("lobby_slot_waiting")}</small>
                      </div>
                    </div>
                    {#if amIHost && idx === 0}
                      <button class="outline-button mini-bot-btn" onclick={onAddBot}>
                        <Icon name="bot" size={13} /> {t("lobby_btn_alloc_ai")}
                      </button>
                    {/if}
                  </div>
                {/each}
              </div>
            </div>

            <!-- Faction Flag & Color Selector -->
            <div class="faction-picker-panel">
              <div class="section-subhead">
                <span>{t("factions_choose_title")}</span>
                <small>{t("factions_choose_sub")}</small>
              </div>

              <div class="faction-cards-grid">
                {#each ALL_COLORS as c}
                  {@const holder = lobbyPlayers.find((p) => p.color === c)}
                  {@const isMine = holder?.token === myPlayerId}
                  {@const isTaken = Boolean(holder && !isMine)}
                  <button
                    class="faction-choice-card"
                    class:selected={isMine}
                    class:taken={isTaken}
                    disabled={isTaken}
                    onclick={() => onChooseColor(c)}
                  >
                    <FactionFlag color={c} width={34} height={22} />
                    <div class="f-choice-meta">
                      <strong>{getFactionName(c)}</strong>
                      <small>
                        {#if isMine}
                          {t("factions_your_faction")}
                        {:else if holder}
                          {t("factions_occupied_by", { name: holder.name })}
                        {:else}
                          {getFactionDoctrine(c)}
                        {/if}
                      </small>
                    </div>
                  </button>
                {/each}
              </div>
            </div>
          </div>

          <!-- RIGHT: BRIEFING RADIO COMMS & CAMPAIGN RULES SUMMARY -->
          <aside class="briefing-side-col">
            <div class="lobby-comms-box chat-size-{communications.settings.chatSize}">
              <CommunicationsCenter controller={communications} />
            </div>

            <div class="campaign-protocol-box">
              <h4><Icon name="shield" size={14} /> {t("lobby_protocol_title")}</h4>
              <ul>
                <li><strong>{t("lobby_protocol_r1")}</strong> {t("lobby_protocol_r1_desc")}</li>
                <li><strong>{t("lobby_protocol_timer")}</strong> {t("lobby_protocol_timer_desc")}</li>
                <li><strong>{t("lobby_protocol_cards")}</strong> {t("lobby_protocol_cards_desc")}</li>
              </ul>
            </div>
          </aside>
        </div>

        <!-- Briefing Footer Actions -->
        <footer class="briefing-footer">
          <div class="footer-status">
            {#if !amIHost}
              <span class="waiting-host-note">
                <span class="pulse-dot"></span> {t("lobby_waiting_host")}
              </span>
            {:else if lobbyPlayers.length < 2}
              <span class="waiting-host-note">
                {t("lobby_need_more_players")}
              </span>
            {:else}
              <span class="ready-note">
                <Icon name="check" size={15} /> {t("lobby_systems_ready")}
              </span>
            {/if}
          </div>

          <div class="footer-buttons">
            {#if amIHost && lobbyPlayers.length < 6}
              <button class="outline-button add-ai-btn" onclick={onAddBot}>
                <Icon name="bot" size={16} /> {t("lobby_btn_add_ai")}
              </button>
            {/if}

            {#if amIHost}
              <button
                class="launch-battle-btn"
                disabled={lobbyPlayers.length < 2}
                onclick={onStartGame}
              >
                <Icon name="swords" size={18} /> {t("lobby_btn_launch_campaign")}
              </button>
            {/if}
          </div>
        </footer>
      </section>
    </div>
  {/if}
</div>

<style>
  .command-center-backdrop {
    position: fixed;
    inset: 0;
    padding-top: 68px;
    overflow-y: auto;
    overflow-x: hidden;
    z-index: 40;
    background:
      radial-gradient(circle at 50% 25%, rgba(16, 28, 52, 0.55) 0%, rgba(4, 8, 16, 0.92) 75%),
      url("/assets/war-room-bg.webp") center/cover no-repeat;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-start;
  }

  .command-deck-container {
    width: min(1180px, calc(100% - 32px));
    margin: auto;
    padding: 20px 0 40px;
    display: flex;
    flex-direction: column;
    gap: 22px;
  }

  /* Hero Emblem Lockup */
  .deck-hero {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 8px;
  }
  .hero-emblem-img {
    height: clamp(100px, 15vh, 155px);
    width: auto;
    object-fit: contain;
    filter: drop-shadow(0 12px 28px rgba(0, 0, 0, 0.92));
  }
  .hero-tagline {
    font-family: var(--font-tactical);
    font-size: 0.76rem;
    font-weight: 700;
    letter-spacing: 0.2em;
    color: #cbd5e1;
    text-shadow: 0 2px 8px rgba(0, 0, 0, 0.9);
    background: linear-gradient(90deg, transparent, rgba(9, 15, 28, 0.85) 20%, rgba(9, 15, 28, 0.85) 80%, transparent);
    padding: 5px 24px;
    border-top: 1px solid rgba(212, 175, 55, 0.3);
    border-bottom: 1px solid rgba(212, 175, 55, 0.3);
  }

  .deck-grid {
    display: grid;
    grid-template-columns: 1.12fr 0.88fr;
    gap: 22px;
    align-items: stretch;
  }

  .deck-card {
    position: relative;
    background: linear-gradient(165deg, rgba(13, 22, 39, 0.94) 0%, rgba(7, 12, 23, 0.97) 100%);
    border: 1px solid rgba(212, 175, 55, 0.42);
    border-radius: 8px;
    padding: 26px 28px;
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.82), inset 0 1px 0 rgba(255, 255, 255, 0.07);
    backdrop-filter: blur(16px);
  }

  /* Brass Corner Brackets */
  .card-corner {
    position: absolute;
    width: 12px;
    height: 12px;
    border-color: #eab308;
    border-style: solid;
    pointer-events: none;
  }
  .card-corner.tl {
    top: 8px;
    left: 8px;
    border-width: 2px 0 0 2px;
  }
  .card-corner.tr {
    top: 8px;
    right: 8px;
    border-width: 2px 2px 0 0;
  }
  .card-corner.bl {
    bottom: 8px;
    left: 8px;
    border-width: 0 0 2px 2px;
  }
  .card-corner.br {
    bottom: 8px;
    right: 8px;
    border-width: 0 2px 2px 0;
  }

  .primary-ops-card {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    gap: 20px;
  }

  .ops-header h2 {
    font-family: var(--font-display);
    font-size: 1.5rem;
    font-weight: 800;
    color: #f8fafc;
    letter-spacing: 0.05em;
  }
  .ops-header h3 {
    font-family: var(--font-display);
    font-size: 1.12rem;
    font-weight: 800;
    color: #f8fafc;
    letter-spacing: 0.04em;
  }
  .row-spread {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
  }

  /* Commander ID Card */
  .commander-id-card {
    background: rgba(5, 9, 18, 0.82);
    border: 1px solid rgba(148, 163, 184, 0.25);
    border-radius: 6px;
    padding: 14px 16px;
  }
  .commander-id-card.authenticated {
    display: flex;
    align-items: center;
    gap: 14px;
    border-color: rgba(234, 179, 8, 0.45);
    background: linear-gradient(90deg, rgba(202, 138, 4, 0.12), rgba(5, 9, 18, 0.88));
  }
  .cid-meta {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .cid-badges {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 2px;
  }
  .status-pill {
    font-family: var(--font-tactical);
    font-size: 0.62rem;
    font-weight: 800;
    letter-spacing: 0.1em;
    padding: 2px 6px;
    border-radius: 3px;
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .status-pill.verified {
    background: rgba(234, 179, 8, 0.2);
    color: #fef08a;
    border: 1px solid rgba(234, 179, 8, 0.45);
  }
  .status-pill.ranked {
    background: rgba(16, 185, 129, 0.18);
    color: #6ee7b7;
    border: 1px solid rgba(16, 185, 129, 0.4);
  }
  .cid-meta strong {
    font-family: var(--font-tactical);
    font-size: 1.05rem;
    color: #f8fafc;
  }
  .cid-meta small {
    font-family: var(--font-mono);
    font-size: 0.72rem;
    color: #94a3b8;
  }
  .cid-action {
    margin-left: auto;
  }

  .commander-id-card.guest {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .guest-field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .guest-field label {
    font-family: var(--font-tactical);
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.1em;
    color: #cbd5e1;
  }
  .guest-auth-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 8px;
    padding-top: 8px;
    border-top: 1px solid rgba(148, 163, 184, 0.15);
    font-size: 0.75rem;
    color: #94a3b8;
  }
  .text-gold-btn {
    border: 0;
    background: transparent;
    color: #fde047;
    font-family: var(--font-tactical);
    font-size: 0.78rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    padding: 4px 6px;
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  .text-gold-btn:hover:not(:disabled) {
    background: rgba(234, 179, 8, 0.12);
    color: #ffffff;
    border-color: transparent;
  }

  /* Launch Campaign CTA */
  .launch-campaign-btn {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 16px 20px;
    background: linear-gradient(135deg, #ca8a04 0%, #854d0e 100%);
    border: 1px solid #fde047;
    border-radius: 6px;
    color: #ffffff;
    text-align: left;
    box-shadow: 0 10px 30px rgba(202, 138, 4, 0.32), inset 0 1px 0 rgba(255, 255, 255, 0.25);
  }
  .launch-campaign-btn:hover:not(:disabled) {
    background: linear-gradient(135deg, #eab308 0%, #a16207 100%);
    border-color: #fef08a;
    transform: translateY(-1px);
    box-shadow: 0 14px 36px rgba(234, 179, 8, 0.45);
  }
  .launch-icon-box {
    width: 46px;
    height: 46px;
    border-radius: 6px;
    background: rgba(6, 10, 19, 0.35);
    border: 1px solid rgba(254, 240, 138, 0.45);
    display: grid;
    place-items: center;
    color: #fef08a;
    flex-shrink: 0;
  }
  .launch-text {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .launch-text strong {
    font-family: var(--font-display);
    font-size: 1.05rem;
    letter-spacing: 0.08em;
    color: #ffffff;
  }
  .launch-text small {
    font-family: var(--font-sans);
    font-size: 0.76rem;
    font-weight: 400;
    color: #fef08a;
    opacity: 0.92;
  }

  .tactical-divider {
    display: flex;
    align-items: center;
    gap: 12px;
    color: #64748b;
    font-family: var(--font-tactical);
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.16em;
  }
  .tactical-divider::before,
  .tactical-divider::after {
    content: "";
    flex: 1;
    height: 1px;
    background: rgba(148, 163, 184, 0.2);
  }

  .join-operation-box {
    display: flex;
    gap: 10px;
  }
  .code-input-wrap {
    flex: 1;
    display: flex;
    align-items: center;
    background: rgba(5, 9, 18, 0.92);
    border: 1px solid rgba(148, 163, 184, 0.32);
    border-radius: 5px;
    padding-left: 12px;
  }
  .code-prefix {
    font-family: var(--font-mono);
    font-size: 0.78rem;
    font-weight: 700;
    color: #eab308;
    user-select: none;
  }
  .code-input-wrap input {
    border: 0;
    background: transparent;
    font-family: var(--font-mono);
    font-size: 0.95rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    width: 100%;
  }
  .code-input-wrap input:focus {
    box-shadow: none;
  }
  .join-btn {
    padding: 0 20px;
    background: linear-gradient(145deg, #1e293b, #0f172a);
    border: 1px solid rgba(212, 175, 55, 0.45);
    color: #fef08a;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 0.85rem;
    text-transform: uppercase;
  }
  .join-btn:hover:not(:disabled) {
    background: linear-gradient(145deg, #26354d, #162238);
    border-color: #fde047;
    color: #ffffff;
  }

  /* Side Column Cards */
  .deck-side-column {
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
  .intel-specs-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    margin-top: 14px;
  }
  .spec-item {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 12px;
    background: rgba(5, 9, 18, 0.68);
    border: 1px solid rgba(148, 163, 184, 0.16);
    border-radius: 5px;
  }
  .spec-icon {
    color: #eab308;
    margin-top: 2px;
  }
  .spec-item strong {
    display: block;
    font-family: var(--font-tactical);
    font-size: 0.84rem;
    color: #f8fafc;
  }
  .spec-item small {
    display: block;
    font-size: 0.7rem;
    color: #94a3b8;
    line-height: 1.35;
    margin-top: 2px;
  }

  /* Mini Leaderboard */
  .mini-rank-card {
    flex: 1;
    display: flex;
    flex-direction: column;
  }
  .mini-rank-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 14px;
  }
  .mini-rank-row {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 9px 12px;
    background: rgba(5, 9, 18, 0.72);
    border: 1px solid rgba(148, 163, 184, 0.16);
    border-radius: 5px;
    text-align: left;
  }
  .m-rank {
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 0.9rem;
    color: #eab308;
    width: 24px;
  }
  .m-info {
    display: flex;
    flex-direction: column;
    min-width: 0;
    flex: 1;
  }
  .m-info strong {
    font-family: var(--font-tactical);
    font-size: 0.86rem;
    color: #f8fafc;
  }
  .m-info small {
    font-size: 0.68rem;
    color: #94a3b8;
  }
  .m-score {
    font-family: var(--font-mono);
    font-size: 0.78rem;
    color: #fef08a;
  }
  .mini-rank-empty {
    margin-top: 14px;
    padding: 18px;
    background: rgba(5, 9, 18, 0.65);
    border: 1px dashed rgba(148, 163, 184, 0.25);
    border-radius: 6px;
    text-align: center;
    color: #94a3b8;
    font-size: 0.8rem;
  }
  .mini-rank-Quicklinks {
    display: flex;
    justify-content: center;
    gap: 10px;
    margin-top: 12px;
  }

  /* ==========================================================================
     PRE-GAME BRIEFING ROOM (LOBBY) — REFINED SPACING & BUTTON HOVER
     ========================================================================== */
  .briefing-room-container {
    width: min(1180px, calc(100% - 32px));
    margin: auto;
    padding: 24px 0 40px;
  }
  .briefing-card {
    display: flex;
    flex-direction: column;
    gap: 24px;
    padding: 28px 32px;
  }
  .briefing-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 16px;
    padding-bottom: 18px;
    border-bottom: 1px solid rgba(212, 175, 55, 0.28);
  }
  .briefing-title-group {
    display: flex;
    align-items: center;
    gap: 16px;
  }
  .briefing-mini-logo {
    height: 62px;
    width: auto;
    object-fit: contain;
  }
  .op-code-row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 12px;
    margin-top: 3px;
  }
  .op-code-row h2 {
    font-family: var(--font-display);
    font-size: 1.5rem;
    color: #f8fafc;
  }
  .op-code-val {
    font-family: var(--font-mono);
    color: #fde047;
    letter-spacing: 0.1em;
  }
  .copy-code-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 34px;
    padding: 0 12px;
    font-size: 0.74rem;
    background: rgba(202, 138, 4, 0.16);
    border-color: rgba(234, 179, 8, 0.5);
    color: #fef08a;
  }
  .copy-code-btn:hover:not(:disabled) {
    background: rgba(234, 179, 8, 0.28);
    border-color: #fde047;
    color: #ffffff;
  }
  .briefing-header-right {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .capacity-pill {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    height: 38px;
    padding: 0 14px;
    background: rgba(5, 9, 18, 0.85);
    border: 1px solid rgba(148, 163, 184, 0.28);
    border-radius: 5px;
    font-family: var(--font-tactical);
    font-size: 0.82rem;
    letter-spacing: 0.08em;
    color: #cbd5e1;
  }
  .capacity-pill strong {
    color: #fde047;
  }
  .leave-room-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 38px;
    padding: 0 14px;
    background: rgba(127, 29, 29, 0.35);
    border-color: rgba(239, 68, 68, 0.45);
    color: #fca5a5;
    font-size: 0.78rem;
    text-transform: uppercase;
  }
  .leave-room-btn:hover:not(:disabled) {
    background: rgba(153, 27, 27, 0.65);
    border-color: #f87171;
    color: #ffffff;
  }

  .briefing-body-grid {
    display: grid;
    grid-template-columns: 1.32fr 0.68fr;
    gap: 24px;
    align-items: start;
  }
  .briefing-main-col {
    display: flex;
    flex-direction: column;
    gap: 24px;
  }
  .roster-block,
  .faction-picker-panel {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .section-subhead {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 8px;
  }
  .section-subhead span {
    font-family: var(--font-tactical);
    font-size: 0.8rem;
    font-weight: 800;
    letter-spacing: 0.12em;
    color: #eab308;
  }
  .section-subhead small {
    font-size: 0.73rem;
    color: #94a3b8;
  }

  .slots-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }
  .slot-card {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 62px;
    padding: 12px 14px;
    background: rgba(5, 9, 18, 0.85);
    border: 1px solid rgba(148, 163, 184, 0.22);
    border-left: 3px solid #eab308;
    border-radius: 6px;
  }
  .slot-card.is-me {
    background: linear-gradient(90deg, rgba(202, 138, 4, 0.16), rgba(5, 9, 18, 0.9));
    border-color: rgba(234, 179, 8, 0.55);
  }
  .slot-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    flex: 1;
  }
  .slot-name-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .slot-name-row strong {
    font-family: var(--font-tactical);
    font-size: 0.94rem;
    color: #f8fafc;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .me-tag {
    font-family: var(--font-mono);
    font-size: 0.58rem;
    font-weight: 800;
    background: #eab308;
    color: #050911;
    padding: 1px 5px;
    border-radius: 3px;
  }
  .slot-info small {
    font-size: 0.7rem;
    color: #94a3b8;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .slot-badges {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .role-badge {
    font-family: var(--font-tactical);
    font-size: 0.62rem;
    font-weight: 800;
    letter-spacing: 0.08em;
    padding: 3px 7px;
    border-radius: 3px;
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .role-badge.host {
    background: rgba(234, 179, 8, 0.2);
    color: #fde047;
    border: 1px solid rgba(234, 179, 8, 0.45);
  }
  .role-badge.bot {
    background: rgba(56, 189, 248, 0.16);
    color: #7dd3fc;
    border: 1px solid rgba(56, 189, 248, 0.35);
  }
  .role-badge.human {
    background: rgba(30, 41, 59, 0.8);
    color: #cbd5e1;
  }
  .remove-bot-btn {
    width: 26px;
    height: 26px;
    padding: 0;
    display: grid;
    place-items: center;
    background: rgba(127, 29, 29, 0.4);
    border-color: rgba(239, 68, 68, 0.45);
    color: #fca5a5;
  }
  .remove-bot-btn:hover:not(:disabled) {
    background: rgba(185, 28, 28, 0.7);
    border-color: #f87171;
    color: #ffffff;
  }

  .slot-card.empty-slot {
    border-style: dashed;
    border-left-style: solid;
    border-left-color: #334155;
    background: rgba(5, 9, 18, 0.45);
    justify-content: space-between;
  }
  .empty-slot-left {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .empty-slot-num {
    font-family: var(--font-mono);
    font-size: 0.78rem;
    font-weight: 800;
    color: #475569;
  }
  .empty-slot-left strong {
    display: block;
    font-family: var(--font-tactical);
    font-size: 0.84rem;
    color: #64748b;
  }
  .empty-slot-left small {
    font-size: 0.66rem;
    color: #475569;
  }
  .mini-bot-btn {
    padding: 5px 10px;
    font-size: 0.72rem;
  }

  /* Faction Picker */
  .faction-cards-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 10px;
  }
  .faction-choice-card {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 11px 13px;
    background: rgba(5, 9, 18, 0.82);
    border: 1px solid rgba(148, 163, 184, 0.22);
    border-radius: 6px;
    text-align: left;
  }
  .faction-choice-card:hover:not(:disabled) {
    background: rgba(15, 23, 42, 0.92);
    border-color: rgba(234, 179, 8, 0.55);
  }
  .faction-choice-card.selected {
    background: linear-gradient(135deg, rgba(202, 138, 4, 0.25), rgba(161, 98, 7, 0.1));
    border-color: #fde047;
    box-shadow: 0 0 15px rgba(234, 179, 8, 0.22);
  }
  .faction-choice-card.taken {
    opacity: 0.42;
  }
  .f-choice-meta {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .f-choice-meta strong {
    font-family: var(--font-tactical);
    font-size: 0.86rem;
    color: #f8fafc;
  }
  .f-choice-meta small {
    font-size: 0.68rem;
    color: #94a3b8;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Lobby Comms & Protocol */
  .briefing-side-col {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .lobby-comms-box {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 360px;
    background: rgba(5, 9, 18, 0.85);
    border: 1px solid rgba(148, 163, 184, 0.22);
    border-radius: 6px;
    padding: 14px;
    transition: min-height 0.2s ease;
  }
  .lobby-comms-box.chat-size-large {
    min-height: 460px;
  }
  .lobby-comms-box.chat-size-expanded {
    min-height: 580px;
  }

  .campaign-protocol-box {
    background: rgba(12, 20, 36, 0.85);
    border: 1px solid rgba(212, 175, 55, 0.28);
    border-radius: 6px;
    padding: 14px 16px;
  }
  .campaign-protocol-box h4 {
    font-family: var(--font-tactical);
    font-size: 0.78rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: #eab308;
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 8px;
  }
  .campaign-protocol-box ul {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 0.73rem;
    color: #cbd5e1;
    line-height: 1.45;
  }

  /* Footer */
  .briefing-footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 16px;
    padding-top: 20px;
    margin-top: 4px;
    border-top: 1px solid rgba(212, 175, 55, 0.25);
  }
  .waiting-host-note {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 0.82rem;
    color: #94a3b8;
  }
  .ready-note {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 0.85rem;
    color: #6ee7b7;
    font-weight: 600;
  }
  .pulse-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #eab308;
    box-shadow: 0 0 8px #eab308;
  }
  .footer-buttons {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 12px;
  }
  .add-ai-btn {
    height: 46px;
    padding: 0 18px;
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
  .launch-battle-btn {
    height: 46px;
    padding: 0 26px;
    background: linear-gradient(135deg, #eab308 0%, #a16207 100%);
    border: 1px solid #fef08a;
    border-radius: 6px;
    color: #050911;
    font-family: var(--font-display);
    font-weight: 900;
    font-size: 0.92rem;
    letter-spacing: 0.1em;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 9px;
    box-shadow: 0 8px 25px rgba(234, 179, 8, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.35);
    transition: transform 0.16s ease, box-shadow 0.16s ease, background 0.16s ease, border-color 0.16s ease;
  }
  .launch-battle-btn:hover:not(:disabled) {
    background: linear-gradient(135deg, #fde047 0%, #ca8a04 100%);
    border-color: #ffffff;
    color: #050911;
    transform: translateY(-1px);
    box-shadow: 0 12px 32px rgba(250, 204, 21, 0.55), 0 0 18px rgba(234, 179, 8, 0.4);
  }
  .launch-battle-btn:active:not(:disabled) {
    transform: translateY(0);
  }

  /* Tablet Landscape & Portrait Responsiveness (768px - 1080px) */
  @media (max-width: 1080px) {
    .command-deck-container,
    .briefing-room-container {
      width: min(960px, calc(100% - 28px));
      padding: 16px 0 32px;
    }
    .deck-grid,
    .briefing-body-grid {
      grid-template-columns: 1fr;
    }
    .briefing-card,
    .deck-card {
      padding: 22px 24px;
    }
    .slots-grid {
      grid-template-columns: 1fr 1fr;
    }
    .faction-cards-grid {
      grid-template-columns: repeat(3, 1fr);
    }
    .lobby-comms-box {
      min-height: 310px;
    }
  }

  /* Smaller Tablets & Large Phones (< 760px) */
  @media (max-width: 760px) {
    .command-center-backdrop {
      padding-top: 62px;
    }
    .slots-grid {
      grid-template-columns: 1fr;
    }
    .faction-cards-grid {
      grid-template-columns: 1fr 1fr;
    }
    .intel-specs-grid {
      grid-template-columns: 1fr;
    }
    .briefing-footer {
      flex-direction: column;
      align-items: stretch;
    }
    .footer-buttons {
      width: 100%;
      justify-content: stretch;
    }
    .add-ai-btn,
    .launch-battle-btn {
      flex: 1;
      justify-content: center;
    }
  }
</style>