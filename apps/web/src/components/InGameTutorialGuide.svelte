<script lang="ts">
  import { onMount } from "svelte";
  import type { GameState } from "@hegemonia/shared";
  import { CLASSIC_MAP } from "@hegemonia/maps";
  import Icon from "./Icon.svelte";
  import type { IconName } from "../lib/icons.js";
  import { sound } from "../audio.js";

  interface Props {
    game: GameState;
    myPlayerId: string;
    isMyTurn: boolean;
    activeStep?: number;
    onStepChange?: (step: number) => void;
    onOpenMarket: () => void;
    onOpenObjective: () => void;
    onInspectTerritory: (territoryId: string) => void;
    onSelectCombatTerritories?: (fromId: string, toId: string) => void;
    onAdvancePhase?: () => void;
    onClose: () => void;
  }

  let {
    game,
    myPlayerId,
    isMyTurn,
    activeStep = $bindable(0),
    onStepChange,
    onOpenMarket,
    onOpenObjective,
    onInspectTerritory,
    onSelectCombatTerritories,
    onAdvancePhase,
    onClose,
  }: Props = $props();

  let minimized = $state(false);

  interface TutorialStepDef {
    id: string;
    stepNumber: number;
    badge: string;
    icon: IconName;
    title: string;
    description: string;
    actionMission: string;
    tacticalTip: string;
    actionButtonText?: string;
    actionButtonIcon?: IconName;
  }

  const TUTORIAL_STEPS: TutorialStepDef[] = [
    {
      id: "deploy",
      stepNumber: 1,
      badge: "FASE 1: REFORÇOS & ALOCAÇÃO",
      icon: "phase-deploy",
      title: "Recrutamento e Alocação de Tropas",
      description:
        "No início de cada rodada você recebe exércitos de reserva calculados pelo número de territórios e continentes sob seu comando. Reforçar suas posições fronteiriças é essencial para manter a linha de defesa e preparar investidas.",
      actionMission:
        "Clique em qualquer território seu no mapa e use o botão 'CONFIRMAR REFORÇO' no Console Inferior para alocar suas divisões de reserva.",
      tacticalTip:
        "Manter continentes inteiros e territórios Capitais rende o maior fluxo de reforços a cada rodada. Quando alocar todas as divisões, avance para a Fase de Ataque!",
      actionButtonText: "Focar Meu Território",
      actionButtonIcon: "eye",
    },
    {
      id: "market",
      stepNumber: 2,
      badge: "MERCADO & RECURSOS ESTRATÉGICOS",
      icon: "market",
      title: "Gestão Econômica, Compra e Venda de Commodities",
      description:
        "O poder militar em Hegemonia depende de 4 recursos estratégicos: Dinheiro ($), Aço (indústrias, tanques e fortificações), Petróleo (combustível para blindados e aviação) e Ouro (cartas táticas e liquidez de emergência).",
      actionMission:
        "Abra o Mercado Global clicando no botão 'MERCADO' no topo da tela. Observe as cotações dinâmicas e experimente comprar ou vender recursos.",
      tacticalTip:
        "Dinheiro guardado no tesouro rende juros compostos de 10% entre rodadas. Nunca deixe seu Petróleo zerar enquanto operar divisões de blindados!",
      actionButtonText: "Abrir Mercado Global",
      actionButtonIcon: "market",
    },
    {
      id: "infrastructure",
      stepNumber: 3,
      badge: "LOGÍSTICA & CONSTRUÇÕES MILITARES",
      icon: "fortress",
      title: "Fortalezas, Indústrias, Portos e Aeródromos",
      description:
        "Territórios sob seu estandarte podem receber infraestruturas militares permanentes: Fortalezas (+1 nos dados de defesa), Indústrias (produção constante de commodities), Portos (transporte naval) e Aeródromos (bases para aviação e pontes aéreas).",
      actionMission:
        "Clique em um território seu no mapa para inspecioná-lo no painel à esquerda (Recon Inspector) e ver as opções de construção e recrutamento.",
      tacticalTip:
        "Territórios capitais possuem 3 slots de construção, enquanto territórios comuns comportam até 2 slots. Você pode expandir a infraestrutura para liberar slots extras.",
      actionButtonText: "Inspecionar Meu Território",
      actionButtonIcon: "fortress",
    },
    {
      id: "combat",
      stepNumber: 4,
      badge: "FASE 2: COMBATE & ARMAS COMBINADAS",
      icon: "phase-attack",
      title: "Ofensivas de Combate e Conquista Territorial",
      description:
        "Na Fase 2 (Ataque): 1º Clique em um território de Origem seu com 2 ou mais divisões. 2º Clique em um território Inimigo adjacente. 3º Regule a quantidade de dados ou tropas no Console Inferior e clique em 'INICIAR OFENSIVA'.",
      actionMission:
        "Selecione um território seu com tropas, escolha o alvo inimigo vizinho e comande o ataque!",
      tacticalTip:
        "Tropas combinadas (Infantaria + Tanques + Artilharia) ativam a Sinergia de Armas Combinadas, garantindo +1 no dado mais alto e maior letalidade.",
      actionButtonText: "Preparar Alvo de Ataque",
      actionButtonIcon: "swords",
    },
    {
      id: "maneuver",
      stepNumber: 5,
      badge: "FASE 3: MANOBRA E REDE DE SUPRIMENTOS",
      icon: "phase-maneuver",
      title: "Remanejamento de Forças e Linhas de Suprimento",
      description:
        "Na Fase 3 (Manobra), você pode redistribuir exércitos para proteger suas fronteiras desguarnecidas. Tanques podem mover até 2 tiles; Navios viajam até 3 tiles marítimos; Aviação voa entre aeroportos aliados.",
      actionMission:
        "Selecione a Origem e o Destino (conectados por linha aliada ininterrupta) e transfira divisões para guarnecer pontos vulneráveis.",
      tacticalTip:
        "Territórios isolados sofrem penalidade de cerco e linhas de suprimento cortadas (-15% de economia e desvantagem defensiva). Mantenha suas rotas conectadas!",
      actionButtonText: "Ir para Fase de Manobra",
      actionButtonIcon: "phase-maneuver",
    },
    {
      id: "victory",
      stepNumber: 6,
      badge: "GEOPOLÍTICA, DEFCON 1 & VITÓRIA",
      icon: "target",
      title: "Tensão Mundial, Diplomacia e Diretiva Secreta",
      description:
        "Conquistas e agressões militares elevam a Tensão Mundial. Em 90%+, o alerta DEFCON 1 nuclear é acionado com risco de aniquilação atômica. Para vencer a partida, cumpra sua Diretiva Estratégica Secreta!",
      actionMission:
        "Consulte sua Diretiva Secreta de Vitória na gaveta no topo direito e continue sua campanha contra os generais IA até a Hegemonia total!",
      tacticalTip:
        "Pactos de Não Agressão e Alianças protegem suas fronteiras enquanto você foca frentes prioritárias. Quebrar um tratado gera Infâmia severa e pode unir o mundo contra você.",
      actionButtonText: "Ver Minha Diretriz Secreta",
      actionButtonIcon: "target",
    },
  ];

  let currentStep = $derived(TUTORIAL_STEPS[activeStep] || TUTORIAL_STEPS[0]);

  function goToStep(index: number) {
    sound.playClick();
    activeStep = Math.max(0, Math.min(TUTORIAL_STEPS.length - 1, index));
    onStepChange?.(activeStep);
  }

  function handleNext() {
    if (activeStep < TUTORIAL_STEPS.length - 1) {
      goToStep(activeStep + 1);
    } else {
      sound.playConquest();
      onClose();
    }
  }

  function handlePrev() {
    if (activeStep > 0) {
      goToStep(activeStep - 1);
    }
  }

  function executeStepShortcut() {
    sound.playClick();
    const myTerrs = Object.values(game.territories).filter((t) => t.ownerId === myPlayerId);
    const firstTerrId = myTerrs[0]?.id || "";

    switch (activeStep) {
      case 0: // Reforços
        if (firstTerrId) onInspectTerritory(firstTerrId);
        break;
      case 1: // Mercado
        onOpenMarket();
        break;
      case 2: // Construção
        if (firstTerrId) onInspectTerritory(firstTerrId);
        break;
      case 3: // Combate
        if (onSelectCombatTerritories && myTerrs.length > 0) {
          // Achar território aliado com inimigo vizinho
          for (const t of myTerrs) {
            const mapTerr = CLASSIC_MAP.territories.find((m) => m.id === t.id);
            const enemyNeighbor = mapTerr?.neighbors.find(
              (nId) => game.territories[nId] && game.territories[nId].ownerId !== myPlayerId
            );
            if (enemyNeighbor) {
              onSelectCombatTerritories(t.id, enemyNeighbor);
              break;
            }
          }
        }
        break;
      case 4: // Manobra
        onAdvancePhase?.();
        break;
      case 5: // Diretiva
        onOpenObjective();
        break;
    }
  }

  let containerEl: HTMLElement | null = $state(null);
  let posX = $state<number | null>(null);
  let posY = $state<number | null>(null);
  let isDragging = $state(false);
  let dragOffset = { x: 0, y: 0 };

  onMount(() => {
    if (typeof window !== "undefined") {
      const w = window.innerWidth;
      const targetW = 480;
      posX = Math.max(16, w - targetW - 20);
      posY = 70;
    }
  });

  function clampPosition(x: number, y: number): { x: number; y: number } {
    if (typeof window === "undefined" || !containerEl) return { x, y };
    const w = window.innerWidth;
    const h = window.innerHeight;
    const rect = containerEl.getBoundingClientRect();
    const pad = 10;
    const clampedX = Math.max(pad, Math.min(w - rect.width - pad, x));
    const clampedY = Math.max(pad, Math.min(h - rect.height - pad, y));
    return { x: clampedX, y: clampedY };
  }

  function handlePointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest("button") || target?.closest("input") || target?.closest("a")) {
      return;
    }
    if (!containerEl) return;
    const rect = containerEl.getBoundingClientRect();
    dragOffset = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
    isDragging = true;
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  }

  function handlePointerMove(e: PointerEvent) {
    if (!isDragging || !containerEl) return;
    const targetX = e.clientX - dragOffset.x;
    const targetY = e.clientY - dragOffset.y;
    const clamped = clampPosition(targetX, targetY);
    posX = clamped.x;
    posY = clamped.y;
  }

  function handlePointerUp(e: PointerEvent) {
    if (isDragging) {
      isDragging = false;
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    }
  }

  function handleWindowResize() {
    if (posX !== null && posY !== null) {
      const clamped = clampPosition(posX, posY);
      posX = clamped.x;
      posY = clamped.y;
    }
  }

  $effect(() => {
    if (minimized !== undefined && posX !== null && posY !== null && containerEl) {
      requestAnimationFrame(() => {
        const clamped = clampPosition(posX!, posY!);
        posX = clamped.x;
        posY = clamped.y;
      });
    }
  });
</script>

<svelte:window onresize={handleWindowResize} />

<aside
  bind:this={containerEl}
  class="ingame-tutorial-container"
  role="region"
  aria-label="Tutorial Interativo em Tempo Real"
  class:minimized
  class:is-dragging={isDragging}
  style={posX !== null && posY !== null ? `left: ${posX}px; top: ${posY}px; right: auto;` : undefined}
>
  {#if minimized}
    <!-- Barra Tática Minimizada (Pill discreto) -->
    <div
      class="tutorial-minimized-pill"
      role="toolbar"
      tabindex="0"
      aria-label="Barra do tutorial arrastável"
      onpointerdown={handlePointerDown}
      onpointermove={handlePointerMove}
      onpointerup={handlePointerUp}
      onpointercancel={handlePointerUp}
      title="Clique e arraste para posicionar o tutorial livremente na tela"
    >
      <div class="pill-badge">
        <Icon name="grip" size={12} color="#eab308" />
        <Icon name="compass" size={14} color="#eab308" />
        <span class="pill-label">TUTORIAL EM TEMPO REAL</span>
        <span class="pill-step">[{activeStep + 1}/6]</span>
      </div>
      <div class="pill-title">{currentStep.title}</div>
      <div class="pill-controls">
        <button
          type="button"
          class="btn-pill-expand"
          onclick={() => {
            sound.playClick();
            minimized = false;
          }}
          title="Expandir Guia do Tutorial"
        >
          <Icon name="chevron-down" size={13} />
          <span>Expandir</span>
        </button>
        <button
          type="button"
          class="btn-pill-close"
          onclick={() => {
            sound.playClick();
            onClose();
          }}
          title="Encerrar Tutorial"
        >
          <Icon name="close" size={12} />
        </button>
      </div>
    </div>
  {:else}
    <!-- Card Principal do Tutorial Interativo -->
    <div class="tutorial-card">
      <div class="card-corner tl"></div>
      <div class="card-corner tr"></div>
      <div class="card-corner bl"></div>
      <div class="card-corner br"></div>

      <!-- Cabeçalho do Card -->
      <header
        class="tutorial-card-header"
        role="region"
        aria-label="Cabeçalho do tutorial arrastável"
        onpointerdown={handlePointerDown}
        onpointermove={handlePointerMove}
        onpointerup={handlePointerUp}
        onpointercancel={handlePointerUp}
        title="Clique e arraste para posicionar o tutorial livremente na tela"
      >
        <!-- Linha Superior: Badge da Fase à esquerda, Controles à direita -->
        <div class="header-top-bar">
          <div class="header-badge-col">
            <span class="step-badge">{currentStep.badge}</span>
          </div>

          <div class="header-actions">
            <span class="step-number">ETAPA {currentStep.stepNumber} DE {TUTORIAL_STEPS.length}</span>
            <span class="drag-handle-hint" title="Clique e arraste para posicionar o tutorial livremente na tela">
              <Icon name="grip" size={12} color="#eab308" />
              <span class="drag-label">ARRASTAR</span>
            </span>
            <button
              type="button"
              class="header-btn"
              onclick={() => {
                sound.playClick();
                minimized = true;
              }}
              title="Minimizar Guia (para ver todo o mapa)"
            >
              <Icon name="chevron-up" size={13} />
              <span class="btn-text">Minimizar</span>
            </button>
            <button
              type="button"
              class="header-btn close"
              onclick={() => {
                sound.playClick();
                onClose();
              }}
              title="Encerrar Guia do Tutorial"
            >
              <Icon name="close" size={13} />
            </button>
          </div>
        </div>

        <!-- Linha Inferior: Ícone e Título da Etapa -->
        <div class="header-title-bar">
          <div class="header-icon-box">
            <Icon name={currentStep.icon} size={16} color="#eab308" />
          </div>
          <h3 class="tutorial-card-title">{currentStep.title}</h3>
        </div>
      </header>

      <!-- Stepper Pills (1 a 6) -->
      <nav class="step-nav" aria-label="Navegação de Etapas">
        {#each TUTORIAL_STEPS as s, idx}
          {@const isActive = idx === activeStep}
          {@const isPassed = idx < activeStep}
          <button
            type="button"
            class="step-nav-dot"
            class:active={isActive}
            class:passed={isPassed}
            onclick={() => goToStep(idx)}
            title="Ir para Etapa {s.stepNumber}: {s.title}"
          >
            <span class="dot-num">{s.stepNumber}</span>
          </button>
        {/each}
      </nav>

      <!-- Corpo da Instrução -->
      <div class="tutorial-body">
        <p class="tutorial-desc">{currentStep.description}</p>

        <!-- Caixa de Ação Imediata -->
        <div class="mission-box">
          <div class="mission-header">
            <Icon name="target" size={13} color="#fde047" />
            <span>OBJETIVO DESTA ETAPA:</span>
          </div>
          <p class="mission-text">{currentStep.actionMission}</p>
          {#if currentStep.actionButtonText}
            <button
              type="button"
              class="btn-mission-action"
              onclick={executeStepShortcut}
            >
              {#if currentStep.actionButtonIcon}
                <Icon name={currentStep.actionButtonIcon} size={14} color="#050911" />
              {/if}
              <span>{currentStep.actionButtonText}</span>
            </button>
          {/if}
        </div>

        <!-- Dica do Alto Comando -->
        <div class="tactical-tip-box">
          <Icon name="compass" size={13} color="#60a5fa" />
          <div class="tip-content">
            <strong>Dica do Alto Comando:</strong>
            <span>{currentStep.tacticalTip}</span>
          </div>
        </div>
      </div>

      <!-- Rodapé com Navegação -->
      <footer class="tutorial-footer">
        <button
          type="button"
          class="btn-nav-prev"
          disabled={activeStep === 0}
          onclick={handlePrev}
        >
          <Icon name="chevron-left" size={13} />
          <span>Anterior</span>
        </button>

        <button
          type="button"
          class="btn-nav-skip"
          onclick={() => {
            sound.playClick();
            onClose();
          }}
        >
          Pular Tutorial
        </button>

        <button
          type="button"
          class="btn-nav-next"
          class:finish={activeStep === TUTORIAL_STEPS.length - 1}
          onclick={handleNext}
        >
          {#if activeStep < TUTORIAL_STEPS.length - 1}
            <span>Próximo Passo</span>
            <Icon name="chevron-right" size={13} />
          {:else}
            <Icon name="crown" size={13} color="#050911" />
            <span>Concluir Tutorial</span>
          {/if}
        </button>
      </footer>
    </div>
  {/if}
</aside>

<style>
  .ingame-tutorial-container {
    position: fixed;
    top: 70px;
    right: 20px;
    z-index: 95;
    width: 480px;
    max-width: calc(100vw - 20px);
    pointer-events: auto;
    font-family: var(--font-tactical);
    user-select: none;
    animation: fadeInTutorial 0.25s ease-out;
  }

  .ingame-tutorial-container.is-dragging {
    transition: none !important;
  }

  .ingame-tutorial-container.is-dragging .tutorial-card,
  .ingame-tutorial-container.is-dragging .tutorial-minimized-pill {
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.9), 0 0 25px rgba(234, 179, 8, 0.35);
    border-color: #fde047;
  }

  @keyframes fadeInTutorial {
    from {
      opacity: 0;
      transform: translateY(-8px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  /* --- Minimized Pill --- */
  .tutorial-minimized-pill {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    height: 38px;
    box-sizing: border-box;
    padding: 0 12px;
    background: rgba(8, 14, 26, 0.94);
    border: 1px solid rgba(234, 179, 8, 0.45);
    border-radius: 6px;
    box-shadow: 0 4px 18px rgba(0, 0, 0, 0.65), 0 0 10px rgba(234, 179, 8, 0.15);
    backdrop-filter: blur(8px);
    cursor: grab;
    touch-action: none;
  }

  .ingame-tutorial-container.is-dragging .tutorial-minimized-pill {
    cursor: grabbing;
  }

  .pill-badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  .pill-label {
    font-size: 0.72rem;
    font-weight: 800;
    letter-spacing: 0.08em;
    color: #fde047;
  }

  .pill-step {
    font-size: 0.68rem;
    font-weight: 700;
    color: #94a3b8;
  }

  .pill-title {
    font-size: 0.74rem;
    color: #cbd5e1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 170px;
  }

  .pill-controls {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }

  .btn-pill-expand {
    height: 26px;
    line-height: 24px;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 0 8px;
    box-sizing: border-box;
    background: rgba(234, 179, 8, 0.15);
    border: 1px solid rgba(234, 179, 8, 0.4);
    border-radius: 4px;
    color: #fef08a;
    font-size: 0.68rem;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .btn-pill-expand:hover {
    background: rgba(234, 179, 8, 0.3);
    border-color: #facc15;
    color: #ffffff;
  }

  .btn-pill-close {
    width: 26px;
    min-width: 26px;
    height: 26px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    box-sizing: border-box;
    background: transparent;
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 4px;
    color: #94a3b8;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .btn-pill-close:hover {
    background: rgba(239, 68, 68, 0.2);
    border-color: rgba(239, 68, 68, 0.5);
    color: #f87171;
  }

  /* --- Full Card --- */
  .tutorial-card {
    position: relative;
    background: rgba(8, 14, 26, 0.96);
    border: 1px solid rgba(234, 179, 8, 0.35);
    border-radius: 8px;
    box-shadow: 0 12px 36px rgba(0, 0, 0, 0.85), 0 0 18px rgba(234, 179, 8, 0.14);
    backdrop-filter: blur(12px);
    overflow: hidden;
    max-height: calc(100vh - 85px);
    display: flex;
    flex-direction: column;
  }

  .card-corner {
    position: absolute;
    width: 8px;
    height: 8px;
    border-color: #eab308;
    pointer-events: none;
    z-index: 2;
  }
  .card-corner.tl {
    top: -1px;
    left: -1px;
    border-top: 2px solid #eab308;
    border-left: 2px solid #eab308;
  }
  .card-corner.tr {
    top: -1px;
    right: -1px;
    border-top: 2px solid #eab308;
    border-right: 2px solid #eab308;
  }
  .card-corner.bl {
    bottom: -1px;
    left: -1px;
    border-bottom: 2px solid #eab308;
    border-left: 2px solid #eab308;
  }
  .card-corner.br {
    bottom: -1px;
    right: -1px;
    border-bottom: 2px solid #eab308;
    border-right: 2px solid #eab308;
  }

  /* --- Header --- */
  .tutorial-card-header {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px 14px 10px;
    background: linear-gradient(180deg, rgba(234, 179, 8, 0.12) 0%, rgba(8, 14, 26, 0.6) 100%);
    border-bottom: 1px solid rgba(234, 179, 8, 0.2);
    cursor: grab;
    touch-action: none;
  }

  .ingame-tutorial-container.is-dragging .tutorial-card-header {
    cursor: grabbing;
  }

  /* Linha Superior: Categoria à esquerda, Controles de mesma altura à direita */
  .header-top-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    min-width: 0;
  }

  .header-badge-col {
    display: flex;
    align-items: center;
    min-width: 0;
    flex: 1;
  }

  .step-badge {
    font-size: 0.65rem;
    font-weight: 800;
    letter-spacing: 0.08em;
    color: #fde047;
    text-transform: uppercase;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* Right-side action controls: TODOS com a MESMA ALTURA (26px) e alinhamento */
  .header-actions {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }

  .step-number {
    height: 26px;
    line-height: 24px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0 8px;
    box-sizing: border-box;
    font-size: 0.65rem;
    font-weight: 700;
    font-family: var(--font-mono);
    color: #cbd5e1;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: 4px;
    white-space: nowrap;
    letter-spacing: 0.04em;
  }

  .drag-handle-hint {
    height: 26px;
    line-height: 24px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    padding: 0 8px;
    box-sizing: border-box;
    font-size: 0.65rem;
    font-weight: 800;
    letter-spacing: 0.05em;
    color: #fde047;
    background: rgba(234, 179, 8, 0.12);
    border: 1px solid rgba(234, 179, 8, 0.35);
    border-radius: 4px;
    white-space: nowrap;
    cursor: grab;
    transition: all 0.15s ease;
  }

  .drag-handle-hint:hover {
    background: rgba(234, 179, 8, 0.22);
    border-color: #facc15;
    color: #ffffff;
  }

  .header-btn {
    height: 26px;
    line-height: 24px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    padding: 0 9px;
    box-sizing: border-box;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 4px;
    color: #cbd5e1;
    font-size: 0.67rem;
    font-weight: 700;
    white-space: nowrap;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .header-btn:hover {
    background: rgba(255, 255, 255, 0.12);
    border-color: rgba(255, 255, 255, 0.3);
    color: #ffffff;
  }

  .header-btn.close {
    width: 26px;
    min-width: 26px;
    height: 26px;
    padding: 0;
    justify-content: center;
    color: #94a3b8;
  }

  .header-btn.close:hover {
    background: rgba(239, 68, 68, 0.25);
    border-color: rgba(239, 68, 68, 0.5);
    color: #fca5a5;
  }

  /* Linha Inferior do Título */
  .header-title-bar {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }

  .header-icon-box {
    width: 28px;
    height: 28px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: rgba(234, 179, 8, 0.15);
    border: 1px solid rgba(234, 179, 8, 0.4);
    border-radius: 5px;
    flex-shrink: 0;
  }

  .tutorial-card-title {
    margin: 0;
    font-size: 0.92rem;
    font-weight: 800;
    letter-spacing: 0.03em;
    color: #ffffff;
    line-height: 1.25;
    white-space: normal;
  }

  /* --- Stepper Dots --- */
  .step-nav {
    display: flex;
    gap: 6px;
    padding: 6px 14px;
    background: rgba(0, 0, 0, 0.35);
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }

  .step-nav-dot {
    flex: 1;
    height: 26px;
    min-width: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .step-nav-dot .dot-num {
    font-size: 0.68rem;
    font-weight: 700;
    color: #64748b;
  }

  .step-nav-dot.passed {
    border-color: rgba(234, 179, 8, 0.4);
    background: rgba(234, 179, 8, 0.1);
  }

  .step-nav-dot.passed .dot-num {
    color: #fde047;
  }

  .step-nav-dot.active {
    border-color: #eab308;
    background: rgba(234, 179, 8, 0.25);
    box-shadow: 0 0 8px rgba(234, 179, 8, 0.3);
  }

  .step-nav-dot.active .dot-num {
    color: #ffffff;
    font-weight: 900;
  }

  /* --- Body --- */
  .tutorial-body {
    padding: 10px 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    overflow-y: auto;
    max-height: calc(100vh - 235px);
  }

  .tutorial-desc {
    margin: 0;
    font-size: 0.78rem;
    color: #cbd5e1;
    line-height: 1.45;
  }

  /* --- Mission Box --- */
  .mission-box {
    background: rgba(234, 179, 8, 0.08);
    border: 1px solid rgba(234, 179, 8, 0.35);
    border-radius: 6px;
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .mission-header {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 0.68rem;
    font-weight: 800;
    letter-spacing: 0.08em;
    color: #fde047;
  }

  .mission-text {
    margin: 0;
    font-size: 0.76rem;
    color: #f8fafc;
    line-height: 1.35;
    font-weight: 600;
  }

  .btn-mission-action {
    align-self: flex-start;
    height: 30px;
    box-sizing: border-box;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-top: 4px;
    padding: 0 14px;
    background: linear-gradient(135deg, #fde047 0%, #ca8a04 100%);
    border: 1px solid #fef08a;
    border-radius: 4px;
    color: #050911;
    font-size: 0.74rem;
    font-weight: 800;
    cursor: pointer;
    box-shadow: 0 2px 8px rgba(234, 179, 8, 0.35);
    transition: all 0.15s ease;
  }

  .btn-mission-action:hover {
    background: linear-gradient(135deg, #ffffff 0%, #eab308 100%);
    box-shadow: 0 4px 14px rgba(234, 179, 8, 0.55);
    transform: translateY(-1px);
  }

  /* --- Tactical Tip Box --- */
  .tactical-tip-box {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 8px 10px;
    background: rgba(30, 58, 138, 0.15);
    border: 1px solid rgba(96, 165, 250, 0.25);
    border-radius: 5px;
    font-size: 0.72rem;
    color: #bfdbfe;
    line-height: 1.35;
  }

  .tip-content strong {
    color: #93c5fd;
    margin-right: 4px;
  }

  /* --- Footer --- */
  .tutorial-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 8px 14px 10px;
    background: rgba(0, 0, 0, 0.4);
    border-top: 1px solid rgba(255, 255, 255, 0.08);
  }

  .btn-nav-prev {
    height: 32px;
    box-sizing: border-box;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    padding: 0 14px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 4px;
    color: #94a3b8;
    font-size: 0.74rem;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .btn-nav-prev:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.12);
    color: #f8fafc;
  }

  .btn-nav-prev:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  .btn-nav-skip {
    height: 32px;
    box-sizing: border-box;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    color: #64748b;
    padding: 0 8px;
    font-size: 0.72rem;
    text-decoration: underline;
    cursor: pointer;
    transition: color 0.15s ease;
  }

  .btn-nav-skip:hover {
    color: #94a3b8;
  }

  .btn-nav-next {
    height: 32px;
    box-sizing: border-box;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 0 16px;
    background: rgba(234, 179, 8, 0.2);
    border: 1px solid rgba(234, 179, 8, 0.5);
    border-radius: 4px;
    color: #fde047;
    font-size: 0.76rem;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .btn-nav-next:hover {
    background: rgba(234, 179, 8, 0.35);
    border-color: #fde047;
    color: #ffffff;
    box-shadow: 0 0 10px rgba(234, 179, 8, 0.3);
  }

  .btn-nav-next.finish {
    background: linear-gradient(135deg, #10b981 0%, #059669 100%);
    border-color: #34d399;
    color: #050911;
    font-weight: 800;
  }

  .btn-nav-next.finish:hover {
    background: linear-gradient(135deg, #34d399 0%, #10b981 100%);
    box-shadow: 0 0 12px rgba(16, 185, 129, 0.5);
  }

  /* --- Responsividade Completa --- */
  @media (max-width: 520px) {
    .ingame-tutorial-container {
      width: calc(100vw - 16px);
      right: 8px;
      top: 60px;
    }
    .tutorial-card-header {
      padding: 8px 10px;
    }
    .step-nav {
      padding: 6px 10px;
    }
    .tutorial-body {
      padding: 8px 10px;
    }
    .tutorial-footer {
      padding: 6px 10px 8px;
    }
  }

  @media (max-width: 440px) {
    .header-btn .btn-text {
      display: none;
    }
    .header-btn {
      width: 26px;
      min-width: 26px;
      padding: 0;
    }
    .drag-handle-hint .drag-label {
      display: none;
    }
    .drag-handle-hint {
      padding: 0 6px;
    }
    .step-number {
      padding: 0 6px;
      font-size: 0.62rem;
    }
    .tutorial-footer {
      gap: 6px;
    }
    .btn-nav-prev,
    .btn-nav-next {
      padding: 0 10px;
      font-size: 0.7rem;
    }
    .btn-nav-skip {
      font-size: 0.68rem;
    }
  }
</style>
