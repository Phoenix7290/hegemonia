<script lang="ts">
  import type { GameState, PlayerColor, PlayerState } from "@hegemonia/shared";
  import FactionFlag from "./FactionFlag.svelte";
  import Icon from "./Icon.svelte";

  let {
    game,
    myPlayerId,
    playerMetrics,
    amIHost = false,
    onReturnRoomToLobby,
    onReturnToLobby,
  }: {
    game: GameState;
    myPlayerId: string | null;
    playerMetrics: {
      player: PlayerState;
      terrCount: number;
      totalArmies: number;
      sharePct: number;
    }[];
    amIHost?: boolean;
    onReturnRoomToLobby?: () => void;
    onReturnToLobby: () => void;
  } = $props();

  let minimized = $state(false);

  const FACTION_NAME_PT: Record<PlayerColor, string> = {
    blue: "União Atlântica (Azul)",
    red: "Diretório Vermelho",
    green: "Pacto Esmeralda (Verde)",
    yellow: "Império Áureo (Amarelo)",
    black: "Legião de Ferro (Preto)",
    white: "Coalizão Boreal (Branco)",
  };

  let winner = $derived(game.players.find((p) => p.id === game.winnerId) ?? null);
  let isWinnerMe = $derived(Boolean(winner && winner.id === myPlayerId));

  let sortedStandings = $derived(
    [...playerMetrics].sort((a, b) => {
      if (a.player.id === game.winnerId) return -1;
      if (b.player.id === game.winnerId) return 1;
      if (b.terrCount !== a.terrCount) return b.terrCount - a.terrCount;
      return b.totalArmies - a.totalArmies;
    })
  );
</script>

{#if minimized}
  <div class="victory-minimized-bar">
    <div class="v-min-left">
      <Icon name="laurel" size={20} />
      <span>
        CAMPANHA ENCERRADA — VITÓRIA DE <strong>{winner?.name?.toUpperCase()}</strong>
      </span>
    </div>
    <div class="v-min-actions">
      <button class="outline-button" onclick={() => (minimized = false)}>
        <Icon name="eye" size={14} /> Ver Relatório Final
      </button>
      <button class="gold-button" onclick={onReturnToLobby}>
        <Icon name="back" size={14} /> Voltar ao Quartel-General
      </button>
    </div>
  </div>
{:else}
  <div class="victory-backdrop">
    <article class="victory-dossier-modal">
      <div class="victory-hero-banner">
        <img src="/assets/victory-header.webp" alt="Hegemonia Alcançada" class="victory-banner-img" />
        <div class="victory-banner-overlay">
          <span class="victory-kicker">
            {isWinnerMe ? "TRIUNFO SUPREMO // DIRETRIZ CUMPRIDA" : "RELATÓRIO DE CAPITULAÇÃO GLOBAL"}
          </span>
          <h2>HEGEMONIA ALCANÇADA</h2>
        </div>
      </div>

      <div class="victory-body">
        {#if winner}
          <div class="winner-showcase">
            <FactionFlag color={winner.color} width={44} height={28} />
            <div class="winner-meta">
              <span class="winner-faction">{FACTION_NAME_PT[winner.color]}</span>
              <h3>Comandante {winner.name}</h3>
            </div>
            <span class="winner-round-badge">RODADA {game.round}</span>
          </div>

          <div class="fulfilled-directive">
            <span class="directive-label"><Icon name="target" size={14} /> Diretriz Estratégica Cumprida:</span>
            <p>{winner.objective.descriptionPt}</p>
          </div>
        {/if}

        <div class="standings-section">
          <h4>Balanço Final de Forças</h4>
          <div class="standings-list">
            {#each sortedStandings as row, i}
              <div class="standing-row" class:winner-row={row.player.id === game.winnerId}>
                <span class="standing-pos">#{i + 1}</span>
                <FactionFlag color={row.player.color} width={22} height={14} />
                <strong class="standing-name">
                  {row.player.name} {row.player.id === myPlayerId ? "(Você)" : ""}
                </strong>
                <span class="standing-stat">{row.terrCount} Territórios ({row.sharePct}%)</span>
                <span class="standing-stat">{row.totalArmies} Divisões</span>
              </div>
            {/each}
          </div>
        </div>

        <div class="crypto-audit-box">
          <div>
            <span>Hash de Compromisso (Seed Commit):</span>
            <code>{game.seedCommitHash}</code>
          </div>
          {#if game.revealedSeed}
            <div>
              <span>Semente Criptográfica Revelada (PRNG):</span>
              <code>{game.revealedSeed}</code>
            </div>
          {/if}
        </div>

        <div class="victory-footer-actions">
          <button class="outline-button" onclick={() => (minimized = true)}>
            <Icon name="globe" size={15} /> Inspecionar Mapa Final
          </button>
          {#if amIHost && onReturnRoomToLobby}
            <button class="outline-button" onclick={onReturnRoomToLobby}>
              <Icon name="users" size={15} /> Reabrir Lobby da Sala
            </button>
          {/if}
          <button class="gold-button" onclick={onReturnToLobby}>
            <Icon name="shield" size={15} /> Retornar ao Quartel-General
          </button>
        </div>
      </div>
    </article>
  </div>
{/if}

<style>
  .victory-backdrop {
    position: fixed;
    inset: 0;
    z-index: 95;
    background: rgba(3, 6, 13, 0.82);
    backdrop-filter: blur(8px);
    display: grid;
    place-items: center;
    padding: 20px;
    pointer-events: auto;
  }

  .victory-dossier-modal {
    width: min(100%, 660px);
    background: linear-gradient(165deg, #111c32 0%, #070c16 100%);
    border: 1px solid rgba(234, 179, 8, 0.65);
    border-radius: 10px;
    overflow: hidden;
    box-shadow: 0 32px 90px rgba(0, 0, 0, 0.95), 0 0 40px rgba(234, 179, 8, 0.18);
  }

  .victory-hero-banner {
    position: relative;
    height: 165px;
    overflow: hidden;
    border-bottom: 1px solid rgba(234, 179, 8, 0.45);
  }
  .victory-banner-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    filter: brightness(0.85);
  }
  .victory-banner-overlay {
    position: absolute;
    inset: 0;
    background: linear-gradient(180deg, rgba(6, 10, 19, 0.25) 0%, rgba(7, 12, 22, 0.96) 100%);
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    align-items: center;
    padding: 18px;
    text-align: center;
  }
  .victory-kicker {
    font-family: var(--font-tactical);
    font-size: 0.74rem;
    font-weight: 800;
    letter-spacing: 0.24em;
    color: #fde047;
    margin-bottom: 4px;
  }
  .victory-banner-overlay h2 {
    font-family: var(--font-display);
    font-size: 2rem;
    font-weight: 900;
    letter-spacing: 0.12em;
    color: #ffffff;
    text-shadow: 0 4px 20px rgba(234, 179, 8, 0.55);
  }

  .victory-body {
    padding: 22px 26px 26px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .winner-showcase {
    display: flex;
    align-items: center;
    gap: 14px;
    background: linear-gradient(90deg, rgba(202, 138, 4, 0.2), rgba(15, 23, 42, 0.8));
    border: 1px solid rgba(234, 179, 8, 0.5);
    padding: 12px 16px;
    border-radius: 6px;
  }
  .winner-meta {
    display: flex;
    flex-direction: column;
  }
  .winner-faction {
    font-family: var(--font-tactical);
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: #fde047;
  }
  .winner-meta h3 {
    font-family: var(--font-display);
    font-size: 1.3rem;
    color: #f8fafc;
  }
  .winner-round-badge {
    margin-left: auto;
    font-family: var(--font-mono);
    font-size: 0.74rem;
    font-weight: 800;
    background: rgba(5, 9, 18, 0.85);
    border: 1px solid rgba(234, 179, 8, 0.4);
    color: #fef08a;
    padding: 5px 10px;
    border-radius: 4px;
  }

  .fulfilled-directive {
    background: rgba(6, 11, 21, 0.85);
    border-left: 3px solid #eab308;
    padding: 12px 14px;
    border-radius: 4px;
  }
  .directive-label {
    display: flex;
    align-items: center;
    gap: 6px;
    font-family: var(--font-tactical);
    font-size: 0.74rem;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: #eab308;
    margin-bottom: 4px;
  }
  .fulfilled-directive p {
    font-size: 0.88rem;
    color: #f1f5f9;
    line-height: 1.45;
  }

  .standings-section h4 {
    font-family: var(--font-tactical);
    font-size: 0.76rem;
    font-weight: 700;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: #94a3b8;
    margin-bottom: 8px;
  }
  .standings-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .standing-row {
    display: grid;
    grid-template-columns: 32px auto 1fr auto auto;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    background: rgba(6, 11, 21, 0.72);
    border: 1px solid rgba(148, 163, 184, 0.16);
    border-radius: 4px;
    font-size: 0.8rem;
  }
  .standing-row.winner-row {
    border-color: rgba(234, 179, 8, 0.5);
    background: rgba(202, 138, 4, 0.12);
  }
  .standing-pos {
    font-family: var(--font-mono);
    font-weight: 800;
    color: #eab308;
  }
  .standing-name {
    color: #f8fafc;
  }
  .standing-stat {
    font-family: var(--font-mono);
    font-size: 0.72rem;
    color: #cbd5e1;
  }

  .crypto-audit-box {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
    background: rgba(4, 7, 14, 0.85);
    border: 1px solid rgba(148, 163, 184, 0.16);
    padding: 10px 12px;
    border-radius: 5px;
    font-size: 0.68rem;
  }
  .crypto-audit-box span {
    display: block;
    color: #64748b;
    margin-bottom: 3px;
  }
  .crypto-audit-box code {
    font-family: var(--font-mono);
    color: #94a3b8;
    word-break: break-all;
  }

  .victory-footer-actions {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    padding-top: 4px;
  }

  .victory-minimized-bar {
    pointer-events: auto;
    position: fixed;
    top: 14px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 90;
    background: linear-gradient(135deg, rgba(15, 24, 42, 0.96), rgba(8, 14, 26, 0.96));
    border: 1px solid #eab308;
    border-radius: 7px;
    padding: 10px 18px;
    display: flex;
    align-items: center;
    gap: 20px;
    box-shadow: 0 16px 40px rgba(0, 0, 0, 0.85);
  }
  .v-min-left {
    display: flex;
    align-items: center;
    gap: 10px;
    color: #fef08a;
    font-family: var(--font-tactical);
    font-size: 0.88rem;
    letter-spacing: 0.06em;
  }
  .v-min-actions {
    display: flex;
    gap: 8px;
  }
</style>
