<script lang="ts">
  import Icon from "./Icon.svelte";

  interface Props {
    wonder: {
      territoryId: string;
      territoryName: string;
      builderName: string;
      builderColor: string;
      roundsHeld: number;
      roundsRequired: number;
      isMine: boolean;
    };
    onFocusTerritory: (territoryId: string) => void;
  }

  let { wonder, onFocusTerritory }: Props = $props();
  let collapsed = $state(false);
</script>

<aside class="wonder-toast-wrapper" role="alert" aria-label="Alerta de Construção da Maravilha Soberana">
  {#if collapsed}
    <div class="wonder-toast-pill-bar">
      <div class="card-corner tl"></div>
      <div class="card-corner tr"></div>
      <div class="card-corner bl"></div>
      <div class="card-corner br"></div>

      <div class="pill-info">
        <Icon name="fortification" size={15} color="#f59e0b" />
        <span class="pill-warning-text">
          ALERTA GLOBAL: MARAVILHA DO BASTIÃO EM {wonder.territoryName.toUpperCase()} ({wonder.roundsHeld}/{wonder.roundsRequired} RODADAS)
        </span>
      </div>

      <div class="pill-actions">
        <button
          type="button"
          class="pill-focus-btn"
          onclick={() => onFocusTerritory(wonder.territoryId)}
          title="Centralizar câmera no território da Maravilha"
        >
          <Icon name="eye" size={13} />
          <span>Localizar</span>
        </button>
        <button
          type="button"
          class="pill-expand-btn"
          onclick={() => (collapsed = false)}
          title="Expandir detalhes da Maravilha"
        >
          <span>Detalhes</span>
          <Icon name="chevron-down" size={13} />
        </button>
      </div>
    </div>
  {:else}
    <div class="wonder-toast-card">
      <div class="card-corner tl"></div>
      <div class="card-corner tr"></div>
      <div class="card-corner bl"></div>
      <div class="card-corner br"></div>

      <header class="toast-header">
        <div class="header-main">
          <div class="header-badge">
            <Icon name="fortification" size={15} color="#f59e0b" />
            <span>ALERTA DE FIM DO MUNDO • BASTIÃO SOBERANO</span>
          </div>
          <h2 id="wonder-modal-title">A Maravilha Soberana Está Sendo Erguida!</h2>
          <p class="toast-subtitle">
            O general <strong>{wonder.builderName}</strong> estabeleceu a Maravilha em
            <strong>{wonder.territoryName}</strong>. Caso esta fortaleza resista intacta por
            {wonder.roundsRequired} rodadas, <strong>o mundo acaba</strong> e a vitória será imediata!
          </p>
        </div>

        <button
          type="button"
          class="btn-minimize-toast"
          title="Recolher alerta para barra compacta"
          onclick={() => (collapsed = true)}
        >
          <Icon name="chevron-up" size={14} />
          <span>Recolher</span>
        </button>
      </header>

      <div class="wonder-progress-section">
        <div class="wonder-bar-header">
          <span>Contagem Regressiva para o Fim do Mundo:</span>
          <strong>{wonder.roundsHeld} / {wonder.roundsRequired} Rodadas ({Math.round((wonder.roundsHeld / wonder.roundsRequired) * 100)}%)</strong>
        </div>
        <div class="wonder-track">
          <div
            class="wonder-fill"
            style="width: {Math.min(100, Math.round((wonder.roundsHeld / wonder.roundsRequired) * 100))}%;"
          ></div>
        </div>
      </div>

      <footer class="toast-footer">
        <span class="footer-hint">
          {#if wonder.isMine}
            Defenda esta província a todo custo para consolidar a vitória do Bastião.
          {:else}
            Mobilize suas divisões e ataque o território antes que a contagem se esgote!
          {/if}
        </span>
        <button
          type="button"
          class="btn-focus-wonder"
          onclick={() => onFocusTerritory(wonder.territoryId)}
        >
          <Icon name="compass" size={14} />
          <span>Localizar {wonder.territoryName}</span>
        </button>
      </footer>
    </div>
  {/if}
</aside>

<style>
  .wonder-toast-wrapper {
    position: fixed;
    top: 72px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 1000;
    pointer-events: auto;
    width: min(640px, calc(100vw - 32px));
    animation: toast-slide-in 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  }

  @keyframes toast-slide-in {
    from {
      opacity: 0;
      transform: translate(-50%, -16px);
    }
    to {
      opacity: 1;
      transform: translate(-50%, 0);
    }
  }

  .wonder-toast-pill-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    background: rgba(12, 16, 24, 0.94);
    border: 1px solid rgba(245, 158, 11, 0.45);
    border-radius: 6px;
    padding: 8px 14px;
    box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.8), 0 0 20px rgba(245, 158, 11, 0.2);
    position: relative;
    backdrop-filter: blur(10px);
  }

  .pill-info {
    display: flex;
    align-items: center;
    gap: 8px;
    overflow: hidden;
  }

  .pill-warning-text {
    font-size: 0.76rem;
    font-weight: 700;
    letter-spacing: 0.05em;
    color: #fbbf24;
    white-space: nowrap;
    text-overflow: ellipsis;
    overflow: hidden;
  }

  .pill-actions {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }

  .pill-focus-btn,
  .pill-expand-btn {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    background: rgba(245, 158, 11, 0.15);
    border: 1px solid rgba(245, 158, 11, 0.35);
    color: #fde68a;
    font-size: 0.72rem;
    font-weight: 600;
    padding: 4px 10px;
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .pill-focus-btn:hover,
  .pill-expand-btn:hover {
    background: rgba(245, 158, 11, 0.28);
    color: #ffffff;
    border-color: #f59e0b;
  }

  .wonder-toast-card {
    background: rgba(10, 14, 22, 0.96);
    border: 1px solid rgba(245, 158, 11, 0.45);
    border-radius: 8px;
    padding: 16px 20px;
    box-shadow: 0 18px 36px -8px rgba(0, 0, 0, 0.85), 0 0 30px rgba(245, 158, 11, 0.22);
    position: relative;
    backdrop-filter: blur(14px);
  }

  .toast-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 16px;
  }

  .header-main {
    flex: 1;
  }

  .header-badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 0.68rem;
    font-weight: 800;
    letter-spacing: 0.08em;
    color: #fbbf24;
    text-transform: uppercase;
    margin-bottom: 4px;
  }

  .toast-header h2 {
    margin: 0;
    font-size: 1.05rem;
    font-weight: 800;
    letter-spacing: 0.02em;
    color: #f8fafc;
  }

  .toast-subtitle {
    margin: 6px 0 0;
    font-size: 0.82rem;
    line-height: 1.35;
    color: #cbd5e1;
  }

  .toast-subtitle strong {
    color: #fbbf24;
  }

  .btn-minimize-toast {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    background: transparent;
    border: 1px solid rgba(255, 255, 255, 0.12);
    color: #94a3b8;
    font-size: 0.72rem;
    padding: 4px 8px;
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .btn-minimize-toast:hover {
    color: #f8fafc;
    border-color: rgba(255, 255, 255, 0.25);
  }

  .wonder-progress-section {
    margin-top: 14px;
    background: rgba(0, 0, 0, 0.35);
    border: 1px solid rgba(245, 158, 11, 0.2);
    border-radius: 6px;
    padding: 10px 14px;
  }

  .wonder-bar-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 0.78rem;
    margin-bottom: 6px;
    color: #94a3b8;
  }

  .wonder-bar-header strong {
    color: #fbbf24;
    font-size: 0.82rem;
  }

  .wonder-track {
    width: 100%;
    height: 8px;
    background: rgba(255, 255, 255, 0.08);
    border-radius: 999px;
    overflow: hidden;
  }

  .wonder-fill {
    height: 100%;
    background: linear-gradient(90deg, #f59e0b, #eab308, #ef4444);
    box-shadow: 0 0 10px rgba(245, 158, 11, 0.6);
    transition: width 0.4s ease;
  }

  .toast-footer {
    margin-top: 12px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
  }

  .footer-hint {
    font-size: 0.76rem;
    color: #94a3b8;
    font-style: italic;
  }

  .btn-focus-wonder {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: rgba(245, 158, 11, 0.2);
    border: 1px solid #f59e0b;
    color: #fde68a;
    font-size: 0.78rem;
    font-weight: 700;
    padding: 6px 14px;
    border-radius: 4px;
    cursor: pointer;
    flex-shrink: 0;
    transition: all 0.15s ease;
  }

  .btn-focus-wonder:hover {
    background: #f59e0b;
    color: #0b0f19;
  }

  .card-corner {
    position: absolute;
    width: 6px;
    height: 6px;
    border-color: #f59e0b;
    pointer-events: none;
  }

  .card-corner.tl {
    top: -1px;
    left: -1px;
    border-top: 2px solid #f59e0b;
    border-left: 2px solid #f59e0b;
  }

  .card-corner.tr {
    top: -1px;
    right: -1px;
    border-top: 2px solid #f59e0b;
    border-right: 2px solid #f59e0b;
  }

  .card-corner.bl {
    bottom: -1px;
    left: -1px;
    border-bottom: 2px solid #f59e0b;
    border-left: 2px solid #f59e0b;
  }

  .card-corner.br {
    bottom: -1px;
    right: -1px;
    border-bottom: 2px solid #f59e0b;
    border-right: 2px solid #f59e0b;
  }
</style>
