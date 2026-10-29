<script lang="ts">
  import type {
    MatchmakingStatus,
    PublicQueueMode,
  } from "@hegemonia/shared";
  import { t } from "../i18n/index.svelte";
  import Icon from "./Icon.svelte";

  let {
    status,
    busy,
    connecting,
    roomCodeInput = $bindable(),
    onQueue,
    onCancelQueue,
    onConnectMatch,
    onCreateRoom,
    onJoinRoom,
  }: {
    status: MatchmakingStatus;
    busy: boolean;
    connecting: boolean;
    roomCodeInput: string;
    onQueue: (mode: PublicQueueMode) => void;
    onCancelQueue: () => void;
    onConnectMatch: () => void;
    onCreateRoom: () => void;
    onJoinRoom: () => void;
  } = $props();

  function formatElapsed(seconds: number): string {
    const minutes = Math.floor(seconds / 60).toString().padStart(2, "0");
    const remainder = (seconds % 60).toString().padStart(2, "0");
    return `${minutes}:${remainder}`;
  }
</script>

<div class="matchmaking-panel">
  {#if status.status !== "idle"}
    <section class="queue-status" class:matched={status.status === "matched"} aria-live="polite">
      <div class="queue-radar">
        <Icon name={status.status === "matched" ? "check" : "search"} size={24} />
      </div>
      <div class="queue-copy">
        <span class="queue-eyebrow">
          {status.mode === "ranked" ? t("matchmaking_ranked") : t("matchmaking_casual")}
          {#if status.season} · {status.season.name}{/if}
        </span>
        <h3>{status.status === "matched" ? t("matchmaking_found") : t("matchmaking_searching")}</h3>
        <p>
          {status.status === "matched"
            ? t("matchmaking_reservation")
            : t("matchmaking_searching_desc")}
        </p>
      </div>
      <div class="queue-time">
        <Icon name="clock" size={14} />
        <strong>{formatElapsed(status.elapsedSeconds)}</strong>
      </div>
      <div class="queue-actions">
        {#if status.status === "matched"}
          <button class="primary-action" disabled={connecting} onclick={onConnectMatch}>
            <Icon name="swords" size={16} />
            {connecting ? t("matchmaking_connecting") : t("matchmaking_enter_room")}
          </button>
          <span class="room-reservation">OP // {status.roomCode ?? "------"}</span>
        {:else}
          <button class="cancel-action" disabled={busy} onclick={onCancelQueue}>
            <Icon name="close" size={15} /> {t("matchmaking_cancel")}
          </button>
        {/if}
      </div>
    </section>
  {:else}
    <div class="mode-grid">
      <button class="mode-card ranked" disabled={busy || connecting} onclick={() => onQueue("ranked")}>
        <span class="mode-icon"><Icon name="rank" size={23} /></span>
        <span class="mode-copy">
          <span class="mode-kicker">{t("matchmaking_competitive")}</span>
          <strong>{t("matchmaking_ranked")}</strong>
          <small>{t("matchmaking_ranked_desc")}</small>
        </span>
        <span class="mode-impact">{t("matchmaking_rating_on")}</span>
        <Icon name="chevrons" size={16} />
      </button>

      <button class="mode-card casual" disabled={busy || connecting} onclick={() => onQueue("casual")}>
        <span class="mode-icon"><Icon name="globe" size={23} /></span>
        <span class="mode-copy">
          <span class="mode-kicker">{t("matchmaking_public")}</span>
          <strong>{t("matchmaking_casual")}</strong>
          <small>{t("matchmaking_casual_desc")}</small>
        </span>
        <span class="mode-impact">{t("matchmaking_rating_off")}</span>
        <Icon name="chevrons" size={16} />
      </button>
    </div>

    <div class="custom-heading">
      <div>
        <span class="mode-kicker">{t("matchmaking_private")}</span>
        <strong>{t("matchmaking_custom")}</strong>
      </div>
      <span>{t("matchmaking_custom_desc")}</span>
    </div>

    <button class="create-custom" disabled={connecting} onclick={onCreateRoom}>
      <Icon name="users" size={18} />
      <span>{connecting ? t("deck_btn_creating_room") : t("matchmaking_create_custom")}</span>
      <small>{t("matchmaking_rating_off")}</small>
    </button>

    <div class="join-custom">
      <div class="code-input-wrap">
        <span class="code-prefix">OP //</span>
        <input
          bind:value={roomCodeInput}
          maxlength="6"
          aria-label={t("deck_room_code_placeholder")}
          placeholder={t("deck_room_code_placeholder")}
          onkeydown={(event) => event.key === "Enter" && onJoinRoom()}
        />
      </div>
      <button disabled={connecting || !roomCodeInput.trim()} onclick={onJoinRoom}>
        <Icon name="compass" size={16} /> {t("deck_btn_join")}
      </button>
    </div>
  {/if}
</div>

<style>
  .matchmaking-panel {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .mode-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }

  .mode-card {
    position: relative;
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 10px;
    min-width: 0;
    padding: 15px;
    text-align: left;
    border: 1px solid rgba(148, 163, 184, 0.28);
    border-radius: 6px;
    background: linear-gradient(145deg, rgba(17, 28, 46, 0.96), rgba(6, 12, 23, 0.96));
    color: #cbd5e1;
    transition: border-color 0.16s ease, transform 0.16s ease, background 0.16s ease;
  }

  .mode-card:hover:not(:disabled) {
    transform: translateY(-2px);
    border-color: #eab308;
    background: linear-gradient(145deg, rgba(37, 43, 48, 0.98), rgba(10, 16, 27, 0.98));
  }

  .mode-card.ranked {
    border-color: rgba(234, 179, 8, 0.5);
  }

  .mode-card.casual {
    border-color: rgba(56, 189, 248, 0.35);
  }

  .mode-icon {
    display: grid;
    place-items: center;
    width: 42px;
    height: 42px;
    border: 1px solid rgba(234, 179, 8, 0.35);
    border-radius: 5px;
    background: rgba(234, 179, 8, 0.09);
    color: #fde047;
  }

  .casual .mode-icon {
    border-color: rgba(56, 189, 248, 0.35);
    background: rgba(56, 189, 248, 0.08);
    color: #7dd3fc;
  }

  .mode-copy {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }

  .mode-kicker,
  .queue-eyebrow {
    color: #94a3b8;
    font-family: var(--font-tactical);
    font-size: 0.59rem;
    font-weight: 700;
    letter-spacing: 0.13em;
    text-transform: uppercase;
  }

  .mode-copy strong,
  .custom-heading strong {
    color: #f8fafc;
    font-family: var(--font-display);
    font-size: 1rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .mode-copy small {
    min-height: 30px;
    color: #94a3b8;
    font-size: 0.68rem;
    line-height: 1.4;
  }

  .mode-impact {
    grid-column: 1 / -1;
    width: fit-content;
    padding: 3px 6px;
    border: 1px solid rgba(234, 179, 8, 0.28);
    border-radius: 3px;
    color: #fef08a;
    font-family: var(--font-tactical);
    font-size: 0.61rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .casual .mode-impact {
    border-color: rgba(148, 163, 184, 0.24);
    color: #cbd5e1;
  }

  .mode-card > :global(.heg-icon) {
    position: absolute;
    top: 14px;
    right: 12px;
    transform: rotate(-90deg);
    color: #64748b;
  }

  .custom-heading {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 12px;
    padding-top: 8px;
    border-top: 1px solid rgba(148, 163, 184, 0.16);
  }

  .custom-heading > div {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .custom-heading > span {
    color: #64748b;
    font-size: 0.65rem;
  }

  .create-custom,
  .join-custom button,
  .primary-action,
  .cancel-action {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    border-radius: 5px;
    font-family: var(--font-tactical);
    font-weight: 700;
  }

  .create-custom {
    width: 100%;
    min-height: 43px;
    padding: 9px 13px;
    border: 1px solid rgba(212, 175, 55, 0.4);
    background: rgba(202, 138, 4, 0.12);
    color: #fef08a;
  }

  .create-custom small {
    margin-left: auto;
    color: #94a3b8;
    font-size: 0.58rem;
    text-transform: uppercase;
  }

  .create-custom:hover:not(:disabled),
  .join-custom button:hover:not(:disabled) {
    border-color: #fde047;
    background: rgba(202, 138, 4, 0.22);
    color: #fff;
  }

  .join-custom {
    display: flex;
    gap: 8px;
  }

  .code-input-wrap {
    display: flex;
    align-items: center;
    flex: 1;
    min-width: 0;
    padding-left: 11px;
    border: 1px solid rgba(148, 163, 184, 0.28);
    border-radius: 5px;
    background: rgba(5, 9, 18, 0.92);
  }

  .code-prefix {
    color: #eab308;
    font-family: var(--font-mono);
    font-size: 0.73rem;
    font-weight: 700;
  }

  .code-input-wrap input {
    width: 100%;
    min-width: 0;
    border: 0;
    background: transparent;
    box-shadow: none;
    font-family: var(--font-mono);
    font-size: 0.82rem;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }

  .join-custom button {
    padding: 0 14px;
    border: 1px solid rgba(212, 175, 55, 0.4);
    background: #111c2d;
    color: #fef08a;
    font-size: 0.72rem;
    text-transform: uppercase;
  }

  .queue-status {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: 14px;
    padding: 20px;
    border: 1px solid rgba(56, 189, 248, 0.4);
    border-radius: 7px;
    background: radial-gradient(circle at 15% 50%, rgba(14, 116, 144, 0.15), transparent 50%), rgba(5, 11, 21, 0.8);
  }

  .queue-status.matched {
    border-color: rgba(16, 185, 129, 0.55);
    background: radial-gradient(circle at 15% 50%, rgba(16, 185, 129, 0.15), transparent 50%), rgba(5, 11, 21, 0.85);
  }

  .queue-radar {
    display: grid;
    place-items: center;
    width: 52px;
    height: 52px;
    border: 1px solid #38bdf8;
    border-radius: 50%;
    color: #7dd3fc;
    box-shadow: 0 0 20px rgba(56, 189, 248, 0.15);
  }

  .matched .queue-radar {
    border-color: #10b981;
    color: #6ee7b7;
    box-shadow: 0 0 20px rgba(16, 185, 129, 0.18);
  }

  .queue-copy h3 {
    margin: 3px 0;
    color: #f8fafc;
    font-family: var(--font-display);
    font-size: 1.15rem;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }

  .queue-copy p {
    margin: 0;
    color: #94a3b8;
    font-size: 0.72rem;
    line-height: 1.45;
  }

  .queue-time {
    display: flex;
    align-items: center;
    gap: 5px;
    color: #cbd5e1;
    font-family: var(--font-mono);
  }

  .queue-actions {
    grid-column: 2 / -1;
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .primary-action,
  .cancel-action {
    min-height: 36px;
    padding: 0 13px;
    border: 1px solid rgba(16, 185, 129, 0.55);
    background: rgba(16, 185, 129, 0.14);
    color: #a7f3d0;
    font-size: 0.73rem;
  }

  .cancel-action {
    border-color: rgba(239, 68, 68, 0.4);
    background: rgba(127, 29, 29, 0.2);
    color: #fca5a5;
  }

  .room-reservation {
    color: #6ee7b7;
    font-family: var(--font-mono);
    font-size: 0.68rem;
  }

  @media (max-width: 520px) {
    .mode-grid {
      grid-template-columns: 1fr;
    }

    .custom-heading > span {
      display: none;
    }

    .queue-status {
      grid-template-columns: auto 1fr;
      padding: 15px;
    }

    .queue-time {
      grid-column: 2;
    }

    .queue-actions {
      grid-column: 1 / -1;
      flex-wrap: wrap;
    }
  }
</style>
