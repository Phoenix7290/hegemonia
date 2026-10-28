<script lang="ts">
  import type { CombatRollResult, PlayerState } from "@hegemonia/shared";
  import { CLASSIC_MAP } from "@hegemonia/maps";
  import type { CommunicationsController } from "../lib/communications.svelte";
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

  const territoryNameMap = new Map(CLASSIC_MAP.territories.map((t) => [t.id, t.namePt]));

  const COLOR_HEX: Record<string, string> = {
    blue: "#3b82f6",
    red: "#ef4444",
    green: "#10b981",
    yellow: "#f59e0b",
    black: "#64748b",
    white: "#e2e8f0",
  };

  interface ParsedLogEntry {
    raw: string;
    kind: "combat" | "conquest" | "deploy" | "trade" | "round" | "timeout" | "comms" | "victory" | "info";
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
        tag: "RÁDIO",
        playerColor,
        text: raw.replace(/^\[COMMS\]\s*/, ""),
      };
    }

    if (raw.startsWith("[TEMPO]")) {
      return {
        raw,
        kind: "timeout",
        tag: "TEMPO",
        playerColor,
        text: raw.replace(/^\[TEMPO\]\s*/, ""),
      };
    }

    if (/HEGEMONIA|venceu|Vitória/i.test(raw)) {
      return {
        raw,
        kind: "victory",
        tag: "VITÓRIA",
        playerColor,
        text: raw,
      };
    }

    if (/CONQUISTADO|conquistou/i.test(raw)) {
      const diceMatch = raw.match(/\[([\d,\s•]+)\]\s*vs\s*\[([\d,\s•]+)\]/i);
      return {
        raw,
        kind: "conquest",
        tag: "CONQUISTA",
        playerColor,
        text: raw,
        attDice: diceMatch ? diceMatch[1] : undefined,
        defDice: diceMatch ? diceMatch[2] : undefined,
      };
    }

    if (/Atacou|Ataque|Combate|\bvs\b/i.test(raw)) {
      const diceMatch = raw.match(/\[([\d,\s•]+)\]\s*vs\s*\[([\d,\s•]+)\]/i);
      return {
        raw,
        kind: "combat",
        tag: "COMBATE",
        playerColor,
        text: raw,
        attDice: diceMatch ? diceMatch[1] : undefined,
        defDice: diceMatch ? diceMatch[2] : undefined,
      };
    }

    if (/trocou|cartas|suprimento/i.test(raw)) {
      return {
        raw,
        kind: "trade",
        tag: "SUPRIMENTO",
        playerColor,
        text: raw,
      };
    }

    if (/posicionou|reforço|divisões|remanejou|manobra|avançou/i.test(raw)) {
      return {
        raw,
        kind: "deploy",
        tag: "ORDEM",
        playerColor,
        text: raw,
      };
    }

    if (/Rodada|Turno|Início/i.test(raw)) {
      return {
        raw,
        kind: "round",
        tag: "FASE",
        playerColor,
        text: raw,
      };
    }

    return {
      raw,
      kind: "info",
      tag: "INTEL",
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
</script>

<aside
  class="war-journal-panel chat-size-{communications.settings.chatSize}"
  class:collapsed
  class:communications-open={activeTab === "chat" && !collapsed}
>
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
        <Icon name="log" size={13} />
        <span>Diário de Guerra</span>
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
        <Icon name="chat" size={13} />
        <span>Rádio Comms</span>
        {#if communications.totalUnread > 0}
          <small class="j-count comms-count">{communications.totalUnread}</small>
        {/if}
      </button>
    </div>

    <button
      class="j-collapse-btn"
      onclick={() => (collapsed = !collapsed)}
      title={collapsed ? "Expandir Diário" : "Recolher Diário"}
    >
      {collapsed ? "▲" : "▼"}
    </button>
  </div>

  {#if !collapsed}
    {#if lastCombat && activeTab === "log"}
      <div class="combat-telemetry-card" class:conquered={lastCombat.conquered}>
        <div class="telemetry-top">
          <span class="telemetry-route">
            {territoryNameMap.get(lastCombat.fromTerritoryId) ?? lastCombat.fromTerritoryId}
            <strong>→</strong>
            {territoryNameMap.get(lastCombat.toTerritoryId) ?? lastCombat.toTerritoryId}
          </span>
          {#if lastCombat.conquered}
            <span class="conquered-pill">TOMADO</span>
          {:else}
            <span class="losses-pill">
              Baixas: ATQ -{lastCombat.attackerLosses} / DEF -{lastCombat.defenderLosses}
            </span>
          {/if}
        </div>

        <div class="dice-comparison-row">
          <div class="dice-group att-group">
            <span class="dice-side-label">ATQ</span>
            {#each lastCombat.attackerDice as d, i}
              {@const defDie = lastCombat.defenderDice[i]}
              {@const wonPair = defDie !== undefined && d > defDie}
              <span class="die-pip att-pip" class:die-win={wonPair}>{d}</span>
            {/each}
          </div>

          <span class="dice-vs">VS</span>

          <div class="dice-group def-group">
            {#each lastCombat.defenderDice as d, i}
              {@const attDie = lastCombat.attackerDice[i]}
              {@const wonPair = attDie !== undefined && d >= attDie}
              <span class="die-pip def-pip" class:die-win={wonPair}>{d}</span>
            {/each}
            <span class="dice-side-label">DEF</span>
          </div>
        </div>

        {#if lastCombat.lastStandBonus}
          <div class="last-stand-badge" title="Bônus de Mobilização Total / Última Resistência">
            ⭐ Mobilização Total ({lastCombat.attackerModifier ? `ATQ +${lastCombat.attackerModifier}` : `DEF +${lastCombat.defenderModifier}`})
          </div>
        {/if}
      </div>
    {/if}

    {#if activeTab === "log"}
      <div class="journal-scroller">
        {#each combatLogs as entry}
          <div
            class="journal-entry kind-{entry.kind}"
            style={entry.playerColor ? `border-left-color: ${entry.playerColor};` : ""}
          >
            <div class="entry-top">
              <span class="entry-tag tag-{entry.kind}">{entry.tag}</span>
              {#if entry.attDice && entry.defDice}
                <div class="inline-dice-badges">
                  <span class="mini-att">ATQ [{entry.attDice}]</span>
                  <span class="mini-def">DEF [{entry.defDice}]</span>
                </div>
              {/if}
            </div>
            <p class="entry-text">{entry.text}</p>
          </div>
        {:else}
          <div class="journal-empty">Aguardando primeiras movimentações táticas...</div>
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
    grid-column: 3;
    grid-row: 3;
    align-self: end;
    justify-self: end;
    width: 100%;
    max-height: 280px;
    background: linear-gradient(180deg, rgba(11, 18, 33, 0.95) 0%, rgba(6, 11, 21, 0.97) 100%);
    border: 1px solid rgba(212, 175, 55, 0.44);
    border-radius: 7px;
    box-shadow: 0 16px 38px rgba(0, 0, 0, 0.8), inset 0 1px 0 rgba(255, 255, 255, 0.06);
    padding: 0.65rem 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
    backdrop-filter: blur(14px);
    transition: width 0.2s ease, max-height 0.2s ease;
  }
  .war-journal-panel.collapsed {
    max-height: 44px;
  }
  .war-journal-panel.communications-open {
    max-height: calc(100vh - 96px);
    z-index: 30;
  }
  .war-journal-panel:not(.collapsed).chat-size-large {
    width: min(490px, calc(100vw - 24px));
    max-height: 360px;
  }
  .war-journal-panel.communications-open.chat-size-large {
    max-height: calc(100vh - 96px);
  }
  .war-journal-panel:not(.collapsed).chat-size-expanded {
    width: min(640px, calc(100vw - 24px));
    max-height: 440px;
    z-index: 35;
  }
  .war-journal-panel.communications-open.chat-size-expanded {
    max-height: calc(100vh - 88px);
  }

  .journal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.4rem;
  }
  .journal-tabs {
    display: flex;
    gap: 0.3rem;
  }
  .j-tab {
    background: rgba(15, 23, 42, 0.65);
    border: 1px solid rgba(148, 163, 184, 0.2);
    color: #94a3b8;
    font-family: var(--font-tactical);
    font-size: 0.75rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    padding: 0.25rem 0.55rem;
    border-radius: 4px;
    display: inline-flex;
    align-items: center;
    gap: 0.32rem;
  }
  .j-tab.active {
    background: linear-gradient(135deg, rgba(202, 138, 4, 0.24), rgba(161, 98, 7, 0.12));
    border-color: rgba(234, 179, 8, 0.6);
    color: #fef08a;
  }
  .j-count {
    font-family: var(--font-mono);
    font-size: 0.62rem;
    background: rgba(5, 9, 18, 0.8);
    padding: 1px 5px;
    border-radius: 3px;
    color: #cbd5e1;
  }
  .comms-count {
    color: #38bdf8;
  }
  .j-collapse-btn {
    background: transparent;
    border: 1px solid rgba(148, 163, 184, 0.2);
    color: #94a3b8;
    width: 24px;
    height: 24px;
    padding: 0;
    display: grid;
    place-items: center;
    border-radius: 4px;
    font-size: 0.7rem;
  }

  /* Telemetry Box */
  .combat-telemetry-card {
    background: rgba(6, 10, 19, 0.92);
    border: 1px solid rgba(148, 163, 184, 0.25);
    border-left: 3px solid #ef4444;
    border-radius: 5px;
    padding: 0.42rem 0.55rem;
    display: flex;
    flex-direction: column;
    gap: 0.32rem;
  }
  .combat-telemetry-card.conquered {
    border-left-color: #10b981;
    border-color: rgba(16, 185, 129, 0.4);
  }
  .telemetry-top {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.72rem;
  }
  .telemetry-route {
    font-family: var(--font-tactical);
    font-weight: 700;
    color: #f1f5f9;
    letter-spacing: 0.03em;
  }
  .telemetry-route strong {
    color: #eab308;
    margin: 0 3px;
  }
  .conquered-pill {
    background: rgba(16, 185, 129, 0.22);
    border: 1px solid #10b981;
    color: #6ee7b7;
    font-family: var(--font-tactical);
    font-size: 0.64rem;
    font-weight: 800;
    letter-spacing: 0.08em;
    padding: 1px 6px;
    border-radius: 3px;
  }
  .losses-pill {
    font-family: var(--font-mono);
    font-size: 0.63rem;
    color: #94a3b8;
  }

  .dice-comparison-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.4rem;
  }
  .dice-group {
    display: flex;
    align-items: center;
    gap: 0.28rem;
  }
  .dice-side-label {
    font-family: var(--font-tactical);
    font-size: 0.66rem;
    font-weight: 800;
    letter-spacing: 0.08em;
    color: #94a3b8;
  }
  .die-pip {
    width: 21px;
    height: 21px;
    border-radius: 4px;
    font-family: var(--font-mono);
    font-size: 0.74rem;
    font-weight: 800;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    opacity: 0.65;
  }
  .att-pip {
    background: rgba(127, 29, 29, 0.55);
    border: 1px solid rgba(248, 113, 113, 0.45);
    color: #fecaca;
  }
  .def-pip {
    background: rgba(30, 58, 138, 0.55);
    border: 1px solid rgba(147, 197, 253, 0.45);
    color: #bfdbfe;
  }
  .die-pip.die-win {
    opacity: 1;
    box-shadow: 0 0 8px rgba(250, 204, 21, 0.35);
    border-color: #fde047;
  }
  .dice-vs {
    font-family: var(--font-tactical);
    font-size: 0.65rem;
    font-weight: 800;
    color: #64748b;
  }

  .last-stand-badge {
    margin-top: 0.35rem;
    padding: 0.2rem 0.5rem;
    background: linear-gradient(90deg, rgba(245, 158, 11, 0.25), rgba(239, 68, 68, 0.25));
    border: 1px solid #f59e0b;
    border-radius: 4px;
    font-family: var(--font-tactical);
    font-size: 0.66rem;
    font-weight: 800;
    letter-spacing: 0.06em;
    color: #fde047;
    text-align: center;
    text-transform: uppercase;
    box-shadow: 0 0 10px rgba(245, 158, 11, 0.2);
  }

  /* Log Scroller */
  .journal-scroller {
    overflow-y: auto;
    height: 138px;
    display: flex;
    flex-direction: column;
    gap: 0.28rem;
    padding-right: 0.2rem;
  }
  .journal-entry {
    padding: 0.28rem 0.45rem;
    background: rgba(15, 23, 42, 0.55);
    border-left: 3px solid #475569;
    border-radius: 3px;
    display: flex;
    flex-direction: column;
    gap: 0.14rem;
  }
  .journal-entry.kind-conquest {
    background: rgba(6, 78, 59, 0.28);
  }
  .journal-entry.kind-round {
    background: rgba(202, 138, 4, 0.12);
    border-left-color: #eab308;
  }
  .journal-entry.kind-timeout {
    background: rgba(127, 29, 29, 0.28);
    border-left-color: #ef4444;
  }
  .entry-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.35rem;
  }
  .entry-tag {
    font-family: var(--font-tactical);
    font-size: 0.6rem;
    font-weight: 800;
    letter-spacing: 0.1em;
    padding: 0px 5px;
    border-radius: 2px;
    background: rgba(30, 41, 59, 0.9);
    color: #cbd5e1;
  }
  .tag-conquest {
    background: rgba(16, 185, 129, 0.25);
    color: #6ee7b7;
  }
  .tag-combat {
    background: rgba(239, 68, 68, 0.22);
    color: #fca5a5;
  }
  .tag-trade,
  .tag-round {
    background: rgba(234, 179, 8, 0.22);
    color: #fef08a;
  }
  .tag-comms {
    background: rgba(56, 189, 248, 0.2);
    color: #7dd3fc;
    width: fit-content;
  }
  .inline-dice-badges {
    display: flex;
    gap: 0.25rem;
    font-family: var(--font-mono);
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
    font-size: 0.72rem;
    line-height: 1.32;
    color: #e2e8f0;
  }
  .journal-empty {
    color: #64748b;
    font-size: 0.74rem;
    text-align: center;
    padding: 1.5rem 0.5rem;
  }

  .journal-communications {
    display: flex;
    min-height: 260px;
    height: min(380px, calc(100vh - 190px));
    transition: height 0.2s ease;
  }
  .war-journal-panel.chat-size-large .journal-communications {
    min-height: 360px;
    height: min(500px, calc(100vh - 150px));
  }
  .war-journal-panel.chat-size-expanded .journal-communications {
    min-height: 460px;
    height: min(640px, calc(100vh - 135px));
  }
  .war-journal-panel.chat-size-large .journal-scroller {
    height: 210px;
  }
  .war-journal-panel.chat-size-expanded .journal-scroller {
    height: 280px;
  }
</style>
