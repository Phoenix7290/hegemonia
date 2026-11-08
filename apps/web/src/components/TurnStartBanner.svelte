<script lang="ts">
  import Icon from "./Icon.svelte";
  import FactionFlag from "./FactionFlag.svelte";
  import { t } from "../i18n/index.svelte";
  import { calculateTurnEconomy } from "@hegemonia/engine";
  import type { GameState, PlayerState } from "@hegemonia/shared";

  interface Props {
    game: GameState;
    myPlayerId: string | null;
    myPlayerState: PlayerState | undefined;
    isMyTurn: boolean;
    onDismiss?: () => void;
  }

  let {
    game,
    myPlayerId,
    myPlayerState,
    isMyTurn,
    onDismiss,
  }: Props = $props();

  let visible = $state(false);
  let lastShownKey = $state("");
  let dismissTimer: ReturnType<typeof setTimeout> | null = null;

  const currentTurnKey = $derived(`${game.round}-${game.turnIndex}-${myPlayerId}`);

  const myEconomy = $derived.by(() => {
    if (!myPlayerState) return null;
    return calculateTurnEconomy(game, myPlayerState);
  });

  $effect(() => {
    if (isMyTurn && game.phase === "deploy" && !game.winnerId) {
      if (lastShownKey !== currentTurnKey) {
        lastShownKey = currentTurnKey;
        visible = true;

        if (dismissTimer) clearTimeout(dismissTimer);
        dismissTimer = setTimeout(() => {
          visible = false;
        }, 5500);
      }
    } else if (!isMyTurn) {
      visible = false;
    }
  });

  function close() {
    visible = false;
    if (dismissTimer) {
      clearTimeout(dismissTimer);
      dismissTimer = null;
    }
    onDismiss?.();
  }
</script>

{#if visible && myPlayerState}
  <div class="turn-banner-backdrop" onclick={close} role="presentation">
    <div
      class="turn-start-card"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => { if (e.key === "Escape") close(); }}
      role="dialog"
      tabindex="-1"
      aria-modal="true"
      aria-label={t("turn_start_title")}
    >
      <div class="banner-top-accent">
        <div class="accent-progress"></div>
      </div>

      <div class="banner-header">
        <div class="header-left">
          <FactionFlag color={myPlayerState.color} width={26} height={16} />
          <div class="header-titles">
            <span class="banner-badge">{t("turn_start_title")}</span>
            <h3>Rodada {game.round} • Ordem de Mobilização</h3>
          </div>
        </div>
        <button class="btn-close-banner" onclick={close} aria-label={t("close")}>
          <Icon name="close" size={14} />
        </button>
      </div>

      <div class="banner-body">
        <!-- Reinforcements Box -->
        <div class="intel-block reinforcements">
          <div class="intel-label">
            <Icon name="infantry" size={15} />
            <span>{t("turn_start_reinforcements")}</span>
          </div>
          <div class="intel-value highlight-gold">
            +{myPlayerState.unplacedArmies}
            <small>Divisões de Linha</small>
          </div>
        </div>

        <!-- Economy Production Box -->
        {#if myEconomy}
          <div class="intel-block economy">
            <div class="intel-label">
              <Icon name="coins" size={15} />
              <span>{t("turn_start_economic_report")}</span>
            </div>
            <div class="commodity-grid">
              <div class="comm-item money">
                <Icon name="coins" size={12} />
                <span>+${myEconomy.netMoney}</span>
              </div>
              <div class="comm-item steel">
                <Icon name="steel" size={12} />
                <span>+{myEconomy.steel}</span>
              </div>
              <div class="comm-item oil">
                <Icon name="oil" size={12} />
                <span>+{myEconomy.oil}</span>
              </div>
              <div class="comm-item gold">
                <Icon name="gold" size={12} />
                <span>+{myEconomy.gold}</span>
              </div>
            </div>
          </div>
        {/if}
      </div>

      {#if game.lastCombat}
        <div class="banner-sitrep">
          <Icon name="alert" size={13} />
          <span>Último combate registrado: baixa geral de tropas nas fronteiras. Verifique o Diário de Guerra.</span>
        </div>
      {/if}

      <div class="banner-actions">
        <button class="btn-assume-command" onclick={close}>
          <Icon name="check" size={14} />
          <span>{t("turn_start_dismiss")}</span>
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .turn-banner-backdrop {
    position: fixed;
    inset: 0;
    z-index: 1200;
    background: rgba(4, 7, 14, 0.45);
    backdrop-filter: blur(2px);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 5.5rem;
    pointer-events: auto;
    animation: fade-in 0.22s ease-out;
  }

  .turn-start-card {
    width: 92%;
    max-width: 480px;
    background: linear-gradient(180deg, rgba(15, 23, 42, 0.98) 0%, rgba(10, 15, 30, 0.98) 100%);
    border: 1px solid rgba(212, 160, 23, 0.5);
    border-radius: 8px;
    box-shadow: 0 16px 36px rgba(0, 0, 0, 0.75), 0 0 24px rgba(212, 160, 23, 0.2);
    overflow: hidden;
    position: relative;
    animation: slide-down 0.25s cubic-bezier(0.16, 1, 0.3, 1);
  }

  .banner-top-accent {
    height: 3px;
    background: rgba(255, 255, 255, 0.1);
    position: relative;
    overflow: hidden;
  }

  .accent-progress {
    height: 100%;
    background: #fbbf24;
    animation: progress-drain 5.5s linear forwards;
  }

  .banner-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.75rem 1rem;
    border-bottom: 1px solid rgba(148, 163, 184, 0.15);
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 0.65rem;
  }

  .header-titles h3 {
    margin: 0;
    font-family: var(--font-tactical);
    font-size: 0.95rem;
    font-weight: 800;
    color: #f8fafc;
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }

  .banner-badge {
    font-size: 0.65rem;
    font-weight: 800;
    color: #fbbf24;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  .btn-close-banner {
    background: none;
    border: none;
    color: #94a3b8;
    cursor: pointer;
    padding: 0.3rem;
    display: flex;
    border-radius: 4px;
    transition: color 0.15s;
  }
  .btn-close-banner:hover {
    color: #f8fafc;
    background: rgba(255, 255, 255, 0.08);
  }

  .banner-body {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.75rem;
    padding: 0.85rem 1rem;
  }

  .intel-block {
    background: rgba(30, 41, 59, 0.45);
    border: 1px solid rgba(148, 163, 184, 0.18);
    border-radius: 6px;
    padding: 0.65rem;
  }

  .intel-label {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.7rem;
    font-weight: 700;
    color: #94a3b8;
    text-transform: uppercase;
    margin-bottom: 0.4rem;
  }

  .intel-value {
    font-family: var(--font-tactical);
    font-size: 1.4rem;
    font-weight: 800;
    display: flex;
    align-items: baseline;
    gap: 0.35rem;
  }
  .intel-value.highlight-gold {
    color: #fbbf24;
  }
  .intel-value small {
    font-size: 0.7rem;
    font-weight: 600;
    color: #cbd5e1;
    text-transform: none;
  }

  .commodity-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.35rem;
  }

  .comm-item {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    font-family: var(--font-mono);
    font-size: 0.75rem;
    font-weight: 700;
    padding: 0.15rem 0.3rem;
    border-radius: 3px;
    background: rgba(0, 0, 0, 0.25);
  }
  .comm-item.money { color: #fef08a; }
  .comm-item.steel { color: #cbd5e1; }
  .comm-item.oil { color: #f97316; }
  .comm-item.gold { color: #f59e0b; }

  .banner-sitrep {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin: 0 1rem 0.6rem;
    padding: 0.45rem 0.65rem;
    background: rgba(15, 23, 42, 0.6);
    border-radius: 4px;
    font-size: 0.7rem;
    color: #94a3b8;
    border-left: 3px solid #38bdf8;
  }

  .banner-actions {
    padding: 0.6rem 1rem 0.85rem;
    display: flex;
    justify-content: flex-end;
  }

  .btn-assume-command {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    padding: 0.45rem 1.1rem;
    border-radius: 4px;
    background: linear-gradient(135deg, #d4a017 0%, #b45309 100%);
    border: 1px solid #fef08a;
    color: #0f172a;
    font-family: var(--font-tactical);
    font-size: 0.82rem;
    font-weight: 800;
    text-transform: uppercase;
    cursor: pointer;
    box-shadow: 0 3px 10px rgba(212, 160, 23, 0.4);
    transition: all 0.16s ease-out;
  }
  .btn-assume-command:hover {
    transform: translateY(-1px);
    box-shadow: 0 5px 14px rgba(212, 160, 23, 0.55);
    filter: brightness(1.1);
  }

  @keyframes progress-drain {
    from { width: 100%; }
    to { width: 0%; }
  }

  @keyframes slide-down {
    from {
      opacity: 0;
      transform: translateY(-16px) scale(0.98);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  @keyframes fade-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }
</style>
