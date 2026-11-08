<script lang="ts">
  import type { CombatRollResult, PlayerState } from "@hegemonia/shared";
  import type { CommunicationsController } from "../lib/communications.svelte";
  import type { IconName } from "../lib/icons";
  import { t } from "../i18n/index.svelte";
  import { getTerritoryName } from "../i18n/content.svelte";
  import CommunicationsCenter from "./CommunicationsCenter.svelte";
  import Icon from "./Icon.svelte";

  let {
    logs,
    lastCombat,
    players,
    communications,
  }: {
    logs: string[];
    lastCombat: CombatRollResult | null;
    players: PlayerState[];
    communications: CommunicationsController;
  } = $props();

  let collapsed = $state(false);
  let activeTab = $state<"log" | "chat">("log");
  let scrollerEl = $state<HTMLDivElement | null>(null);

  const COLOR_HEX: Record<string, string> = {
    blue: "#3b82f6",
    red: "#ef4444",
    green: "#10b981",
    dark_green: "#15803d",
    yellow: "#facc15",
    orange: "#f97316",
    pink: "#ec4899",
    purple: "#a855f7",
    black: "#cbd5e1",
    white: "#F0F0F5",
  };

  interface ParsedLogEntry {
    raw: string;
    kind:
      | "combat"
      | "conquest"
      | "deploy"
      | "trade"
      | "round"
      | "timeout"
      | "comms"
      | "victory"
      | "economy"
      | "construction"
      | "doctrine"
      | "treaty"
      | "info";
    icon: IconName;
    tag: string;
    playerColor: string | null;
    text: string;
    attDice?: string;
    defDice?: string;
  }

  function parseLogEntry(raw: string): ParsedLogEntry {
    let playerColor: string | null = null;
    for (const p of players) {
      if (raw.includes(p.name)) {
        playerColor = COLOR_HEX[p.color] ?? null;
        break;
      }
    }

    if (raw.startsWith("[COMMS]")) {
      return {
        raw,
        kind: "comms",
        icon: "radio",
        tag: t("tag_radio"),
        playerColor,
        text: raw.replace(/^\[COMMS\]\s*/, ""),
      };
    }

    if (raw.startsWith("[TEMPO]")) {
      return {
        raw,
        kind: "timeout",
        icon: "alert",
        tag: t("tag_timeout"),
        playerColor,
        text: raw.replace(/^\[TEMPO\]\s*/, ""),
      };
    }

    if (/HEGEMONIA|venceu|Vitória|VITÓRIA/i.test(raw)) {
      return {
        raw,
        kind: "victory",
        icon: "crown",
        tag: t("tag_victory"),
        playerColor,
        text: raw,
      };
    }

    if (/CONQUISTADO|conquistou/i.test(raw)) {
      const diceMatch = raw.match(/\[([\d,\s•]+)\]\s*vs\s*\[([\d,\s•]+)\]/i);
      return {
        raw,
        kind: "conquest",
        icon: "flag",
        tag: t("tag_conquest"),
        playerColor,
        text: raw,
        attDice: diceMatch ? diceMatch[1] : undefined,
        defDice: diceMatch ? diceMatch[2] : undefined,
      };
    }

    if (/Atacou|Ataque|Combate|\bvs\b|BARRAGEM|BOMBARDEIO/i.test(raw)) {
      const diceMatch = raw.match(/\[([\d,\s•]+)\]\s*vs\s*\[([\d,\s•]+)\]/i);
      return {
        raw,
        kind: "combat",
        icon: "swords",
        tag: t("tag_combat"),
        playerColor,
        text: raw,
        attDice: diceMatch ? diceMatch[1] : undefined,
        defDice: diceMatch ? diceMatch[2] : undefined,
      };
    }

    if (/DOUTRINA|SAQUE TOTAL|adotou a doutrina/i.test(raw)) {
      return {
        raw,
        kind: "doctrine",
        icon: "shield",
        tag: t("tag_doctrine"),
        playerColor,
        text: raw,
      };
    }

    if (/TRATADO|Tratado|proposta de|Aliança|Pacto|Coalizão|fronteira cancelada/i.test(raw)) {
      return {
        raw,
        kind: "treaty",
        icon: "handshake",
        tag: t("tag_treaty"),
        playerColor,
        text: raw,
      };
    }

    if (/construiu|demoliu|expandiu a infraestrutura|evoluiu a Casamata/i.test(raw)) {
      return {
        raw,
        kind: "construction",
        icon: "industry",
        tag: t("tag_construction"),
        playerColor,
        text: raw,
      };
    }

    if (/Economia de|MERCADO GLOBAL|investimento/i.test(raw)) {
      return {
        raw,
        kind: "economy",
        icon: "coins",
        tag: t("tag_economy"),
        playerColor,
        text: raw,
      };
    }

    if (/trocou|cartas|suprimento/i.test(raw)) {
      return {
        raw,
        kind: "trade",
        icon: "coins",
        tag: t("tag_trade"),
        playerColor,
        text: raw,
      };
    }

    if (/posicionou|reforço|divisões|exércitos|remanejou|manobra|avançou/i.test(raw)) {
      return {
        raw,
        kind: "deploy",
        icon: "phase-deploy",
        tag: t("tag_order"),
        playerColor,
        text: raw,
      };
    }

    if (/Rodada|Turno|Início|Partida iniciada/i.test(raw)) {
      return {
        raw,
        kind: "round",
        icon: "clock",
        tag: t("tag_phase"),
        playerColor,
        text: raw,
      };
    }

    return {
      raw,
      kind: "info",
      icon: "compass",
      tag: t("tag_intel"),
      playerColor,
      text: raw,
    };
  }

  let combatLogs = $derived(
    logs
      .filter((l) => !l.startsWith("[COMMS]"))
      .slice(-35)
      .map(parseLogEntry)
  );

  $effect(() => {
    const _len = combatLogs.length;
    if (scrollerEl && activeTab === "log" && !collapsed && _len >= 0) {
      queueMicrotask(() => {
        if (scrollerEl) {
          scrollerEl.scrollTop = scrollerEl.scrollHeight;
        }
      });
    }
  });
</script>

<aside
  class="war-journal-panel chat-size-{communications.settings.chatSize}"
  data-testid="war-journal"
  class:collapsed
  class:communications-open={activeTab === "chat" && !collapsed}
>
  <span class="card-corner tl"></span>
  <span class="card-corner tr"></span>
  <span class="card-corner bl"></span>
  <span class="card-corner br"></span>

  <div class="journal-header">
    <div class="journal-tabs">
      <button
        class="j-tab"
        class:active={activeTab === "log"}
        onclick={() => {
          activeTab = "log";
          collapsed = false;
        }}
      >
        <span class="j-tab-icon"><Icon name="log" size={13} /></span>
        <span>{t("war_journal_title")}</span>
        <small class="j-count">{combatLogs.length}</small>
      </button>

      <button
        class="j-tab"
        class:active={activeTab === "chat"}
        onclick={() => {
          activeTab = "chat";
          collapsed = false;
        }}
      >
        <span class="j-tab-icon"><Icon name="chat" size={13} /></span>
        <span>{t("radio_comms_title")}</span>
        {#if communications.totalUnread > 0}
          <small class="j-count comms-count">{communications.totalUnread}</small>
        {/if}
      </button>
    </div>

    <button
      class="j-collapse-btn"
      onclick={() => (collapsed = !collapsed)}
      aria-label={collapsed ? t("expand_journal") : t("collapse_journal")}
      title={collapsed ? t("expand_journal") : t("collapse_journal")}
    >
      <Icon name={collapsed ? "chevron-up" : "chevron-down"} size={14} />
    </button>
  </div>

  {#if !collapsed}
    {#if lastCombat && activeTab === "log"}
      <div class="combat-telemetry-card" class:conquered={lastCombat.conquered}>
        <div class="telemetry-top">
          <span class="telemetry-route">
            <Icon name="swords" size={12} />
            <span>{getTerritoryName(lastCombat.fromTerritoryId)}</span>
            <strong><Icon name="arrow-right" size={12} /></strong>
            <span>{getTerritoryName(lastCombat.toTerritoryId)}</span>
          </span>
          {#if lastCombat.conquered}
            <span class="conquered-pill">{t("conquest_taken")}</span>
          {:else}
            <span class="losses-pill">
              {t("combat_losses", { att: lastCombat.attackerLosses, def: lastCombat.defenderLosses })}
            </span>
          {/if}
        </div>

        <div class="dice-comparison-row">
          <div class="dice-group att-group">
            <span class="dice-side-label">{t("att_short")}</span>
            {#each lastCombat.attackerDice as d, i}
              {@const defDie = lastCombat.defenderDice[i]}
              {@const wonPair = defDie !== undefined && d > defDie}
              <span class="die-pip att-pip" class:die-win={wonPair}>{d}</span>
            {/each}
          </div>

          <span class="dice-vs">{t("vs")}</span>

          <div class="dice-group def-group">
            {#each lastCombat.defenderDice as d, i}
              {@const attDie = lastCombat.attackerDice[i]}
              {@const wonPair = attDie !== undefined && d >= attDie}
              <span class="die-pip def-pip" class:die-win={wonPair}>{d}</span>
            {/each}
            <span class="dice-side-label">{t("def_short")}</span>
          </div>
        </div>

        {#if lastCombat.lastStandBonus}
          <div class="last-stand-badge" title="Bônus de Mobilização Total / Última Resistência">
            <Icon name="capital" size={12} />
            <span>Mobilização Total ({lastCombat.attackerModifier ? `ATQ +${lastCombat.attackerModifier}` : `DEF +${lastCombat.defenderModifier}`})</span>
          </div>
        {/if}
        {#if lastCombat.unescortedArtilleryPenalty}
          <div class="last-stand-badge" style="background: rgba(239, 68, 68, 0.2); border-color: #ef4444; color: #fca5a5;" title="Artilharia inimiga desprotegida sem escolta de infantaria ou blindados (-1 DEF)">
            <Icon name="artillery" size={12} color="#fca5a5" />
            <span>Artilharia Desprotegida (-1 DEF)</span>
          </div>
        {/if}
      </div>
    {/if}

    {#if activeTab === "log"}
      <div class="journal-scroller" bind:this={scrollerEl}>
        {#each combatLogs as entry}
          <div
            class="journal-entry kind-{entry.kind}"
            data-testid="journal-entry"
            style={entry.playerColor ? `border-left-color: ${entry.playerColor};` : ""}
          >
            <div class="entry-top">
              <span class="entry-tag tag-{entry.kind}">
                <Icon name={entry.icon} size={10} />
                <span>{entry.tag}</span>
              </span>
              {#if entry.attDice && entry.defDice}
                <div class="inline-dice-badges">
                  <span class="mini-att">{t("att_short")} [{entry.attDice}]</span>
                  <span class="mini-def">{t("def_short")} [{entry.defDice}]</span>
                </div>
              {/if}
            </div>
            <p class="entry-text">{entry.text}</p>
          </div>
        {:else}
          <div class="journal-empty">{t("journal_empty_state")}</div>
        {/each}
      </div>
    {:else}
      <div class="journal-communications">
        <CommunicationsCenter controller={communications} compact />
      </div>
    {/if}
  {/if}
</aside>

<style>
  .war-journal-panel {
    pointer-events: auto;
    position: relative;
    grid-column: 3;
    grid-row: 3;
    align-self: end;
    justify-self: end;
    width: 100%;
    max-height: 315px;
    background: linear-gradient(
      180deg,
      rgba(9, 15, 29, 0.97) 0%,
      rgba(5, 9, 18, 0.99) 100%
    );
    border: 1px solid rgba(234, 179, 8, 0.38);
    border-radius: 10px;
    box-shadow:
      0 20px 44px rgba(0, 0, 0, 0.88),
      0 0 24px rgba(234, 179, 8, 0.08),
      inset 0 1px 0 rgba(255, 255, 255, 0.08);
    display: flex;
    flex-direction: column;
    padding: 0.55rem 0.65rem;
    box-sizing: border-box;
    transition: all 0.22s cubic-bezier(0.16, 1, 0.3, 1);
    z-index: 25;
  }
  .war-journal-panel.collapsed {
    max-height: 48px;
    padding: 0.38rem 0.65rem;
  }

  /* Brass brackets */
  .card-corner {
    position: absolute;
    width: 9px;
    height: 9px;
    pointer-events: none;
    z-index: 2;
  }
  .card-corner.tl {
    top: -1px;
    left: -1px;
    border-top: 2px solid #facc15;
    border-left: 2px solid #facc15;
    border-top-left-radius: 10px;
  }
  .card-corner.tr {
    top: -1px;
    right: -1px;
    border-top: 2px solid #facc15;
    border-right: 2px solid #facc15;
    border-top-right-radius: 10px;
  }
  .card-corner.bl {
    bottom: -1px;
    left: -1px;
    border-bottom: 2px solid #facc15;
    border-left: 2px solid #facc15;
    border-bottom-left-radius: 10px;
  }
  .card-corner.br {
    bottom: -1px;
    right: -1px;
    border-bottom: 2px solid #facc15;
    border-right: 2px solid #facc15;
    border-bottom-right-radius: 10px;
  }

  .journal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid rgba(234, 179, 8, 0.22);
    padding-bottom: 0.42rem;
    margin-bottom: 0.42rem;
  }
  .journal-tabs {
    display: flex;
    gap: 0.35rem;
  }
  .j-tab {
    background: transparent;
    border: 1px solid transparent;
    color: #94a3b8;
    padding: 0.28rem 0.55rem;
    border-radius: 6px;
    display: inline-flex;
    align-items: center;
    gap: 0.36rem;
    font-family: var(--font-tactical);
    font-size: 0.74rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .j-tab-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    opacity: 0.85;
  }
  .j-tab:hover {
    color: #f8fafc;
    background: rgba(30, 41, 59, 0.5);
  }
  .j-tab.active {
    background: linear-gradient(
      180deg,
      rgba(234, 179, 8, 0.18) 0%,
      rgba(234, 179, 8, 0.06) 100%
    );
    border-color: rgba(234, 179, 8, 0.45);
    color: #fef08a;
    box-shadow: 0 0 10px rgba(234, 179, 8, 0.15);
  }
  .j-tab.active .j-tab-icon {
    opacity: 1;
  }
  .j-count {
    background: rgba(15, 23, 42, 0.85);
    border: 1px solid rgba(148, 163, 184, 0.3);
    padding: 0.05rem 0.32rem;
    border-radius: 999px;
    font-size: 0.62rem;
    font-weight: 800;
  }
  .j-count.comms-count {
    background: #ef4444;
    border-color: #fca5a5;
    color: #ffffff;
    animation: comms-badge-pulse 1.8s infinite;
  }
  @keyframes comms-badge-pulse {
    0%,
    100% {
      transform: scale(1);
    }
    50% {
      transform: scale(1.1);
    }
  }

  .j-collapse-btn {
    background: rgba(15, 23, 42, 0.6);
    border: 1px solid rgba(148, 163, 184, 0.25);
    color: #94a3b8;
    padding: 0.25rem;
    border-radius: 5px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .j-collapse-btn:hover {
    background: rgba(30, 41, 59, 0.9);
    border-color: #facc15;
    color: #fef08a;
  }

  /* Combat Telemetry Card */
  .combat-telemetry-card {
    background: linear-gradient(
      180deg,
      rgba(15, 23, 42, 0.92) 0%,
      rgba(10, 16, 30, 0.96) 100%
    );
    border: 1px solid rgba(239, 68, 68, 0.38);
    border-radius: 7px;
    padding: 0.38rem 0.5rem;
    margin-bottom: 0.42rem;
    display: flex;
    flex-direction: column;
    gap: 0.28rem;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.45);
  }
  .combat-telemetry-card.conquered {
    border-color: rgba(16, 185, 129, 0.45);
  }
  .telemetry-top {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 0.72rem;
    gap: 0.4rem;
  }
  .telemetry-route {
    color: #f8fafc;
    font-weight: 700;
    display: inline-flex;
    align-items: center;
    gap: 0.32rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .telemetry-route strong {
    color: #ef4444;
    display: inline-flex;
    align-items: center;
  }
  .conquered-pill {
    background: rgba(16, 185, 129, 0.22);
    border: 1px solid #10b981;
    color: #6ee7b7;
    font-family: var(--font-tactical);
    font-size: 0.6rem;
    font-weight: 800;
    letter-spacing: 0.06em;
    padding: 0.1rem 0.4rem;
    border-radius: 4px;
    text-transform: uppercase;
    white-space: nowrap;
  }
  .losses-pill {
    color: #fca5a5;
    font-family: var(--font-tactical);
    font-size: 0.64rem;
    font-weight: 700;
    white-space: nowrap;
  }

  .dice-comparison-row {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.55rem;
  }
  .dice-group {
    display: inline-flex;
    align-items: center;
    gap: 0.24rem;
  }
  .dice-side-label {
    font-family: var(--font-tactical);
    font-size: 0.58rem;
    font-weight: 800;
    letter-spacing: 0.08em;
    color: #94a3b8;
    text-transform: uppercase;
  }
  .die-pip {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    border-radius: 4px;
    font-family: var(--font-tactical);
    font-weight: 900;
    font-size: 0.74rem;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.4);
  }
  .die-pip.att-pip {
    background: linear-gradient(180deg, #dc2626, #991b1b);
    border: 1px solid #f87171;
    color: #ffffff;
  }
  .die-pip.def-pip {
    background: linear-gradient(180deg, #2563eb, #1e40af);
    border: 1px solid #60a5fa;
    color: #ffffff;
  }
  .die-pip.die-win {
    box-shadow: 0 0 8px #facc15;
    border-color: #fef08a;
  }
  .dice-vs {
    font-family: var(--font-tactical);
    font-size: 0.62rem;
    font-weight: 900;
    color: #64748b;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .last-stand-badge {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.22rem 0.5rem;
    background: linear-gradient(90deg, rgba(245, 158, 11, 0.25), rgba(239, 68, 68, 0.25));
    border: 1px solid #f59e0b;
    border-radius: 5px;
    font-family: var(--font-tactical);
    font-size: 0.66rem;
    font-weight: 800;
    color: #fef08a;
    letter-spacing: 0.04em;
    margin-top: 0.15rem;
    box-shadow: 0 2px 6px rgba(245, 158, 11, 0.2);
  }
  .journal-communications {
    overflow-y: auto;
    height: 172px;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  /* Log Scroller & Structured Dispatch Cards */
  .journal-scroller {
    overflow-y: auto;
    height: 172px;
    display: flex;
    flex-direction: column;
    gap: 0.34rem;
    padding-right: 0.2rem;
  }
  .journal-entry {
    padding: 0.36rem 0.55rem;
    background: linear-gradient(
      90deg,
      rgba(15, 23, 42, 0.78) 0%,
      rgba(8, 13, 25, 0.88) 100%
    );
    border: 1px solid rgba(148, 163, 184, 0.16);
    border-left: 3.5px solid #475569;
    border-radius: 6px;
    display: flex;
    flex-direction: column;
    gap: 0.18rem;
  }
  .journal-entry.kind-conquest {
    background: linear-gradient(
      90deg,
      rgba(6, 78, 59, 0.34) 0%,
      rgba(8, 13, 25, 0.88) 100%
    );
    border-color: rgba(16, 185, 129, 0.28);
    border-left-color: #10b981;
  }
  .journal-entry.kind-round {
    background: linear-gradient(
      90deg,
      rgba(202, 138, 4, 0.18) 0%,
      rgba(8, 13, 25, 0.88) 100%
    );
    border-color: rgba(234, 179, 8, 0.28);
    border-left-color: #eab308;
  }
  .journal-entry.kind-timeout {
    background: linear-gradient(
      90deg,
      rgba(127, 29, 29, 0.32) 0%,
      rgba(8, 13, 25, 0.88) 100%
    );
    border-color: rgba(239, 68, 68, 0.3);
    border-left-color: #ef4444;
  }
  .journal-entry.kind-economy {
    background: linear-gradient(
      90deg,
      rgba(16, 185, 129, 0.2) 0%,
      rgba(8, 13, 25, 0.88) 100%
    );
    border-color: rgba(16, 185, 129, 0.28);
    border-left-color: #10b981;
  }
  .journal-entry.kind-construction {
    background: linear-gradient(
      90deg,
      rgba(245, 158, 11, 0.18) 0%,
      rgba(8, 13, 25, 0.88) 100%
    );
    border-color: rgba(245, 158, 11, 0.28);
    border-left-color: #f59e0b;
  }
  .journal-entry.kind-doctrine {
    background: linear-gradient(
      90deg,
      rgba(168, 85, 247, 0.18) 0%,
      rgba(8, 13, 25, 0.88) 100%
    );
    border-color: rgba(168, 85, 247, 0.28);
    border-left-color: #a855f7;
  }
  .journal-entry.kind-treaty {
    background: linear-gradient(
      90deg,
      rgba(56, 189, 248, 0.18) 0%,
      rgba(8, 13, 25, 0.88) 100%
    );
    border-color: rgba(56, 189, 248, 0.28);
    border-left-color: #38bdf8;
  }
  .entry-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.35rem;
  }
  .entry-tag {
    display: inline-flex;
    align-items: center;
    gap: 0.24rem;
    font-family: var(--font-tactical);
    font-size: 0.58rem;
    font-weight: 800;
    letter-spacing: 0.08em;
    padding: 0.08rem 0.38rem;
    border-radius: 4px;
    background: rgba(30, 41, 59, 0.92);
    border: 1px solid rgba(148, 163, 184, 0.22);
    color: #cbd5e1;
  }
  .tag-conquest {
    background: rgba(16, 185, 129, 0.22);
    border-color: rgba(52, 211, 153, 0.4);
    color: #6ee7b7;
  }
  .tag-combat {
    background: rgba(239, 68, 68, 0.22);
    border-color: rgba(248, 113, 113, 0.4);
    color: #fca5a5;
  }
  .tag-trade,
  .tag-round {
    background: rgba(234, 179, 8, 0.22);
    border-color: rgba(250, 204, 21, 0.4);
    color: #fef08a;
  }
  .tag-deploy {
    background: rgba(59, 130, 246, 0.2);
    border-color: rgba(96, 165, 250, 0.38);
    color: #93c5fd;
  }
  .tag-comms {
    background: rgba(56, 189, 248, 0.2);
    border-color: rgba(56, 189, 248, 0.38);
    color: #7dd3fc;
    width: fit-content;
  }
  .tag-economy {
    background: rgba(16, 185, 129, 0.25);
    border-color: rgba(52, 211, 153, 0.4);
    color: #6ee7b7;
  }
  .tag-construction {
    background: rgba(245, 158, 11, 0.25);
    border-color: rgba(250, 204, 21, 0.4);
    color: #fde047;
  }
  .tag-doctrine {
    background: rgba(168, 85, 247, 0.25);
    border-color: rgba(192, 132, 252, 0.4);
    color: #d8b4fe;
  }
  .tag-treaty {
    background: rgba(56, 189, 248, 0.25);
    border-color: rgba(56, 189, 248, 0.4);
    color: #7dd3fc;
  }
  .inline-dice-badges {
    display: flex;
    gap: 0.25rem;
    font-family: var(--font-tactical);
    font-size: 0.62rem;
    font-weight: 700;
  }
  .mini-att {
    color: #fca5a5;
  }
  .mini-def {
    color: #93c5fd;
  }
  .entry-text {
    margin: 0;
    font-size: 0.72rem;
    line-height: 1.38;
    color: #e2e8f0;
    word-break: break-word;
  }
  .journal-empty {
    color: #64748b;
    font-size: 0.72rem;
    text-align: center;
    padding: 1.2rem 0.5rem;
    font-style: italic;
  }

  /* Chat size variations */
  .war-journal-panel.chat-size-compact.communications-open {
    max-height: 250px;
  }
  .war-journal-panel.chat-size-default.communications-open {
    max-height: 380px;
  }
  .war-journal-panel.chat-size-large.communications-open {
    max-height: 500px;
  }
  .war-journal-panel.chat-size-expanded.communications-open {
    max-height: 600px;
    height: min(640px, calc(100vh - 135px));
  }
  .war-journal-panel.chat-size-large .journal-scroller {
    height: 215px;
  }
  .war-journal-panel.chat-size-expanded .journal-scroller {
    height: 285px;
  }
</style>
