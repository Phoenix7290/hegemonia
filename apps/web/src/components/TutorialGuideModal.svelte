<script lang="ts">
  import Icon from "./Icon.svelte";
  import type { IconName } from "../lib/icons";

  interface TutorialStep {
    id: string;
    stepNumber: number;
    title: string;
    eyebrow: string;
    icon: IconName;
    badge: string;
    summary: string;
    highlights: {
      label: string;
      description: string;
      icon: IconName;
    }[];
    proTip: string;
  }

  interface Props {
    open: boolean;
    onClose: () => void;
    onPractice?: () => void;
  }

  let { open = false, onClose, onPractice }: Props = $props();

  let activeStepIndex = $state<number>(0);

  const TUTORIAL_STEPS: TutorialStep[] = [
    {
      id: "economy",
      stepNumber: 1,
      title: "Recursos, Commodities & Economia",
      eyebrow: "MÓDULO DE INTELIGÊNCIA ECONÔMICA",
      icon: "coins",
      badge: "TOPBAR & MERCADO",
      summary:
        "O poderio militar em Hegemonia depende de uma base industrial robusta. O topo da tela exibe suas 4 reservas estratégicas, tesouro nacional e acesso ao Mercado Global.",
      highlights: [
        {
          label: "Aço Estratégico",
          description:
            "Matéria-prima indispensável para blindados, artilharia pesada e fortificações militares.",
          icon: "steel",
        },
        {
          label: "Petróleo Vital",
          description:
            "Combustível para movimentação e Blitzkrieg de blindados, aeronaves e esquadras navais. Se zerado, veículos motorizados ficam imobilizados.",
          icon: "oil",
        },
        {
          label: "Ouro Monetário",
          description:
            "Reserva de valor internacional; compra cartas táticas secretas e fornece liquidez de emergência.",
          icon: "gold",
        },
        {
          label: "Juros de Capital & Mercado",
          description:
            "Tesouro não gasto rende juros compostos entre turnos. No Mercado, você pode comprar e vender commodities sob preços dinâmicos.",
          icon: "market",
        },
      ],
      proTip:
        "Dica Tática: Nunca permita que seu Petróleo chegue a zero enquanto opera divisões de blindados, caso contrário eles não poderão atacar.",
    },
    {
      id: "phases",
      stepNumber: 2,
      title: "Fases do Turno (1-2-3) & Ações",
      eyebrow: "CADÊNCIA OPERACIONAL & CRONÔMETRO",
      icon: "phase-deploy",
      badge: "CONSOLE INFERIOR",
      summary:
        "Cada turno é estruturado em três fases táticas rigorosas no ActionConsole inferior. Mantenha os olhos no cronômetro de 120 segundos para não sofrer penalidades de tempo.",
      highlights: [
        {
          label: "Fase 1: Posicionamento (Deploy)",
          description:
            "Aloque reforços de divisão recebidos por territórios controlados. Construa fábricas, casamatas e recrute divisões especializadas.",
          icon: "phase-deploy",
        },
        {
          label: "Fase 2: Ataque & Combates (Attack)",
          description:
            "Ordene ofensivas terrestres, salvas de artilharia, bombardeios e ataques anfíbios. Blindados com petróleo podem executar Blitzkrieg consecutiva.",
          icon: "phase-attack",
        },
        {
          label: "Fase 3: Manobra Tática (Maneuver)",
          description:
            "Remaneje qualquer quantidade de divisões entre territórios conectados por uma linha contígua e segura de controle soberano.",
          icon: "phase-maneuver",
        },
        {
          label: "Alerta Visual e Sonoro (10s)",
          description:
            "Nos 10 segundos finais do cronômetro, a HUD pulsa em alerta vermelho com aviso sonoro rítmico para prevenir perda involuntária de turno.",
          icon: "clock",
        },
      ],
      proTip:
        "Dica Tática: Na Fase 1, concentre divisões na frente de ruptura antes de avançar para a Fase 2 de ataque.",
    },
    {
      id: "buildings",
      stepNumber: 3,
      title: "Construções & Engenharia Militar",
      eyebrow: "INFRAESTRUTURA DE COMBATE",
      icon: "fortification",
      badge: "RECON INSPECTOR",
      summary:
        "Ao clicar em um território soberano, o ReconInspector lateral permite erguer estruturas de defesa e expansão industrial usando Aço e Tesouro.",
      highlights: [
        {
          label: "Casamatas & Bunkers",
          description:
            "Concedem +1 de defesa e absorvem baixas de combate. Podem ser aprimoradas para Nível 2 (Bunker Blindado de Alta Resistência).",
          icon: "fortification",
        },
        {
          label: "Fábricas & Indústrias",
          description:
            "Aumentam a produção de divisões e a extração econômica de aço e recursos do território.",
          icon: "military_factory",
        },
        {
          label: "Aeródromos Avançados",
          description:
            "Base para missões de reconhecimento aéreo e pontes aéreas (airlifts) para transportar infantaria a qualquer ponto aliado.",
          icon: "airfield",
        },
        {
          label: "Infraestrutura Expandida",
          description:
            "Permite desbloquear slots adicionais de construção em capitais e territórios-chave de fronteira.",
          icon: "plus",
        },
      ],
      proTip:
        "Dica Tática: Fortificações Nível 2 em gargalos geográficos forçam o inimigo a gastar rodadas de artilharia para romper suas linhas.",
    },
    {
      id: "combined_arms",
      stepNumber: 4,
      title: "Armas Combinadas & Doutrinas",
      eyebrow: "SISTEMA INTEGRADO DE COMBATE",
      icon: "tank",
      badge: "5 UNIDADES & SINERGIA",
      summary:
        "O sucesso no campo de batalha exige a combinação harmoniosa de Infantaria, Blindados, Artilharia, Aeronaves e Marinha, potencializados pela sua Doutrina Militar Nacional.",
      highlights: [
        {
          label: "Infantaria & Blindados",
          description:
            "Infantaria forma a linha resistente de defesa e assalto. Blindados exercem penetração rápida e Blitzkrieg com alto poder de dados.",
          icon: "tank",
        },
        {
          label: "Artilharia Pesada",
          description:
            "Dispara barragens à distância contra territórios vizinhos, degradando casamatas e enfraquecendo defesas sem sofrer retaliação.",
          icon: "artillery",
        },
        {
          label: "Apoio Aeronaval",
          description:
            "Aeronaves oferecem apoio tático e interceptação. Esquadras navais disparam salvas de canhão costeiras e escoltam tropas.",
          icon: "aircraft",
        },
        {
          label: "Doutrina Militar Obrigatória",
          description:
            "Cada nação escolhe uma doutrina secreta que concede bônus permanentes (ex: Guerra Relâmpago, Fortaleza Continental, Supremacia Aeronaval).",
          icon: "shield",
        },
      ],
      proTip:
        "Dica Tática: Combine artilharia pesada antes de enviar blindados para minimizar baixas contra territórios fortificados.",
    },
    {
      id: "supply_siege",
      stepNumber: 5,
      title: "Suprimento, Cerco & Bloqueio Naval",
      eyebrow: "LOGÍSTICA & LINHAS DE COMUNICAÇÃO",
      icon: "shield",
      badge: "SUPPLY LINES",
      summary:
        "Exércitos modernos não sobrevivem sem linhas de abastecimento contínuas até a Capital Nacional. Isole o inimigo para vencê-lo pela exaustão.",
      highlights: [
        {
          label: "Capital Nacional",
          description:
            "Sede do seu comando supremo. Se capturada pelo inimigo, acarreta severas penalidades econômicas e de moral para todo o país.",
          icon: "crown",
        },
        {
          label: "Territórios Cercados (Encircled)",
          description:
            "Territórios sem conexão com a capital ficam isolados. Se permanecerem cercados por 2+ rodadas, sofrem penalidade de -1 em dados defensivos.",
          icon: "close",
        },
        {
          label: "Bloqueio Naval Costeiro",
          description:
            "Navios de guerra inimigos em estreitos e mares adjacentes impedem travessias anfíbias e cortam rotas comerciais marítimas.",
          icon: "anchor",
        },
        {
          label: "Reabastecimento Aéreo",
          description:
            "Aeródromos podem ser usados para contornar cercos por terra através de pontes aéreas de emergência.",
          icon: "airfield",
        },
      ],
      proTip:
        "Dica Tática: Corte o território que liga uma guarnição inimiga à sua capital; em 2 rodadas, a defesa inimiga desmorona sob cerco.",
    },
    {
      id: "tension_diplomacy",
      stepNumber: 6,
      title: "Tensão Mundial, Diplomacia & DEFCON 1",
      eyebrow: "GEOPOLÍTICA GLOBAL & VITÓRIA",
      icon: "alert",
      badge: "DIPLOMACIA & OBJETIVOS",
      summary:
        "A guerra mundial não é apenas militar. Conquistas agressivas elevam a Tensão Mundial, forçam tratados diplomáticos e podem desencadear a crise atômica do DEFCON 1.",
      highlights: [
        {
          label: "Medidor de Tensão (0-100%)",
          description:
            "Cada combate, expansão e quebra de pacto eleva a tensão. Em 90%+, o planeta entra em alerta DEFCON 1 com risco de aniquilação nuclear.",
          icon: "alert",
        },
        {
          label: "Tratados & Não-Agressão",
          description:
            "Estabeleça Pactos de Não-Agressão (PNA) e Alianças defensivas bilaterais para assegurar flancos enquanto ataca frentes prioritárias.",
          icon: "users",
        },
        {
          label: "Diretivas Estratégicas Secretas",
          description:
            "Cada general recebe uma diretiva confidencial no início. Cumpra-a para obter o Triunfo Supremo e a Hegemonia alcançada.",
          icon: "target",
        },
        {
          label: "Cenários Táticos Custom",
          description:
            "No Lobby Customizado, experimente cenários assimétricos pré-configurados como Fortaleza Europa, Crise do Petróleo e DEFCON 1 Armageddon.",
          icon: "globe",
        },
      ],
      proTip:
        "Dica Tática: Monitore a tensão mundial. Quebrar um tratado eleva a infâmia e pode unir todos os generais contra a sua hegemonia.",
    },
  ];

  let currentStep = $derived(TUTORIAL_STEPS[activeStepIndex] ?? TUTORIAL_STEPS[0]);

  function nextStep() {
    if (activeStepIndex < TUTORIAL_STEPS.length - 1) {
      activeStepIndex += 1;
    } else {
      onClose();
    }
  }

  function prevStep() {
    if (activeStepIndex > 0) {
      activeStepIndex -= 1;
    }
  }

  function goToStep(idx: number) {
    if (idx >= 0 && idx < TUTORIAL_STEPS.length) {
      activeStepIndex = idx;
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    if (!open) return;
    if (event.key === "Escape") {
      onClose();
    } else if (event.key === "ArrowRight") {
      nextStep();
    } else if (event.key === "ArrowLeft") {
      prevStep();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
  <div class="tutorial-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="tutorial-modal-title">
    <div class="tutorial-dialog-card">
      <div class="card-corner tl"></div>
      <div class="card-corner tr"></div>
      <div class="card-corner bl"></div>
      <div class="card-corner br"></div>

      <!-- Top Header -->
      <header class="tutorial-header">
        <div class="header-left">
          <div class="header-icon-box">
            <Icon name="compass" size={18} color="#eab308" />
          </div>
          <div>
            <span class="tutorial-eyebrow">{currentStep.eyebrow}</span>
            <h2 id="tutorial-modal-title" class="tutorial-title">
              MANUAL TÁTICO: TUTORIAL GUIADO DA HUD
            </h2>
          </div>
        </div>

        <div class="header-actions">
          <span class="step-counter-badge">
            ETAPA {currentStep.stepNumber} DE {TUTORIAL_STEPS.length}
          </span>
          <button type="button" class="close-btn" onclick={onClose} title="Fechar Tutorial">
            <Icon name="close" size={14} />
          </button>
        </div>
      </header>

      <!-- Stepper Progress Navigation -->
      <nav class="tutorial-stepper" aria-label="Etapas do Tutorial">
        {#each TUTORIAL_STEPS as s, idx}
          {@const isActive = idx === activeStepIndex}
          {@const isPassed = idx < activeStepIndex}
          <button
            type="button"
            class="stepper-pill"
            class:active={isActive}
            class:passed={isPassed}
            onclick={() => goToStep(idx)}
          >
            <span class="pill-number">
              {#if isPassed}
                <Icon name="check" size={11} color="#10b981" />
              {:else}
                {s.stepNumber}
              {/if}
            </span>
            <span class="pill-text">{s.badge}</span>
          </button>
        {/each}
      </nav>

      <!-- Step Body Content -->
      <main class="tutorial-content">
        <div class="step-hero-card">
          <div class="step-badge-row">
            <span class="badge-icon">
              <Icon name={currentStep.icon} size={16} color="#eab308" />
            </span>
            <h3 class="step-name">{currentStep.title}</h3>
            <span class="step-location-pill">{currentStep.badge}</span>
          </div>
          <p class="step-summary">{currentStep.summary}</p>
        </div>

        <!-- 4 Grid Highlights -->
        <div class="highlights-grid">
          {#each currentStep.highlights as h}
            <div class="highlight-card">
              <div class="h-header">
                <span class="h-icon-box">
                  <Icon name={h.icon} size={15} color="#eab308" />
                </span>
                <strong class="h-label">{h.label}</strong>
              </div>
              <p class="h-desc">{h.description}</p>
            </div>
          {/each}
        </div>

        <!-- Pro Tip Callout -->
        <div class="pro-tip-box">
          <div class="tip-icon-box">
            <Icon name="shield" size={15} color="#38bdf8" />
          </div>
          <p class="tip-text">{currentStep.proTip}</p>
        </div>
      </main>

      <!-- Footer Navigation Controls -->
      <footer class="tutorial-footer">
        <div class="footer-left">
          {#if onPractice}
            <button type="button" class="practice-btn outline-button" onclick={onPractice}>
              <Icon name="globe" size={15} color="#38bdf8" />
              <span>Experimentar no Mapa</span>
            </button>
          {/if}
          <button type="button" class="skip-btn" onclick={onClose}>
            <span>Pular Tutorial</span>
          </button>
        </div>

        <div class="footer-right">
          <button
            type="button"
            class="nav-btn prev-btn"
            disabled={activeStepIndex === 0}
            onclick={prevStep}
          >
            <Icon name="chevron-left" size={16} />
            <span>Anterior</span>
          </button>

          <button
            type="button"
            class="nav-btn next-btn"
            class:finish-btn={activeStepIndex === TUTORIAL_STEPS.length - 1}
            onclick={nextStep}
          >
            {#if activeStepIndex === TUTORIAL_STEPS.length - 1}
              <Icon name="check" size={16} />
              <span>Concluir Tutorial</span>
            {:else}
              <span>Próximo Passo</span>
              <Icon name="chevron-right" size={16} />
            {/if}
          </button>
        </div>
      </footer>
    </div>
  </div>
{/if}

<style>
  .tutorial-modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 10000;
    background: rgba(3, 7, 18, 0.82);
    backdrop-filter: blur(8px);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1.5rem;
    animation: fadeIn 0.2s ease-out;
  }

  @keyframes fadeIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  .tutorial-dialog-card {
    position: relative;
    width: 100%;
    max-width: 820px;
    max-height: 90vh;
    background: linear-gradient(180deg, #0d131f 0%, #080c14 100%);
    border: 1px solid rgba(234, 179, 8, 0.35);
    box-shadow: 0 25px 60px -15px rgba(0, 0, 0, 0.9), 0 0 30px rgba(234, 179, 8, 0.12);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  /* Card Military Corners */
  .card-corner {
    position: absolute;
    width: 8px;
    height: 8px;
    border-color: #eab308;
    pointer-events: none;
    z-index: 5;
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

  /* Header */
  .tutorial-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1.15rem 1.5rem;
    background: rgba(15, 23, 42, 0.7);
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 0.85rem;
  }

  .header-icon-box {
    width: 36px;
    height: 36px;
    border-radius: 4px;
    background: rgba(234, 179, 8, 0.1);
    border: 1px solid rgba(234, 179, 8, 0.3);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .tutorial-eyebrow {
    display: block;
    font-size: 0.68rem;
    letter-spacing: 0.12em;
    font-weight: 700;
    color: #eab308;
    text-transform: uppercase;
  }

  .tutorial-title {
    margin: 0;
    font-size: 1.05rem;
    font-weight: 800;
    letter-spacing: 0.04em;
    color: #f8fafc;
    font-family: inherit;
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .step-counter-badge {
    padding: 0.25rem 0.65rem;
    background: rgba(234, 179, 8, 0.12);
    border: 1px solid rgba(234, 179, 8, 0.35);
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    color: #fde047;
    border-radius: 3px;
  }

  .close-btn {
    background: transparent;
    border: 1px solid rgba(255, 255, 255, 0.12);
    color: #94a3b8;
    width: 30px;
    height: 30px;
    min-width: 30px;
    min-height: 30px;
    max-width: 30px;
    max-height: 30px;
    aspect-ratio: 1 / 1;
    padding: 0;
    margin: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    border-radius: 3px;
    transition: all 0.15s ease;
    flex-shrink: 0;
    box-sizing: border-box;
  }
  .close-btn:hover {
    color: #f8fafc;
    background: rgba(239, 68, 68, 0.2);
    border-color: rgba(239, 68, 68, 0.4);
  }

  /* Stepper Nav */
  .tutorial-stepper {
    display: grid;
    grid-template-columns: repeat(6, 1fr);
    gap: 0.35rem;
    padding: 0.65rem 1.5rem;
    background: rgba(10, 15, 25, 0.95);
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }

  .stepper-pill {
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.07);
    padding: 0.45rem 0.35rem;
    border-radius: 3px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.2rem;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .stepper-pill:hover {
    background: rgba(255, 255, 255, 0.06);
    border-color: rgba(234, 179, 8, 0.3);
  }
  .stepper-pill.active {
    background: rgba(234, 179, 8, 0.12);
    border-color: #eab308;
    box-shadow: 0 0 10px rgba(234, 179, 8, 0.18);
  }
  .stepper-pill.passed {
    border-color: rgba(16, 185, 129, 0.35);
  }

  .pill-number {
    font-size: 0.72rem;
    font-weight: 800;
    color: #cbd5e1;
  }
  .stepper-pill.active .pill-number {
    color: #fde047;
  }

  .pill-text {
    font-size: 0.62rem;
    font-weight: 700;
    letter-spacing: 0.05em;
    color: #64748b;
    text-align: center;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
  }
  .stepper-pill.active .pill-text {
    color: #f8fafc;
  }

  /* Content */
  .tutorial-content {
    flex: 1;
    overflow-y: auto;
    padding: 1.25rem 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .step-hero-card {
    background: rgba(255, 255, 255, 0.02);
    border: 1px solid rgba(255, 255, 255, 0.06);
    padding: 1rem 1.15rem;
    border-radius: 4px;
    border-left: 3px solid #eab308;
  }

  .step-badge-row {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    margin-bottom: 0.45rem;
  }

  .badge-icon {
    display: flex;
    align-items: center;
  }

  .step-name {
    margin: 0;
    font-size: 1.15rem;
    font-weight: 800;
    color: #f8fafc;
    letter-spacing: 0.02em;
  }

  .step-location-pill {
    margin-left: auto;
    font-size: 0.68rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    padding: 0.2rem 0.5rem;
    background: rgba(56, 189, 248, 0.12);
    border: 1px solid rgba(56, 189, 248, 0.35);
    color: #38bdf8;
    border-radius: 2px;
  }

  .step-summary {
    margin: 0;
    font-size: 0.88rem;
    line-height: 1.5;
    color: #cbd5e1;
  }

  /* Highlights Grid */
  .highlights-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 0.75rem;
  }

  .highlight-card {
    background: rgba(15, 23, 42, 0.6);
    border: 1px solid rgba(255, 255, 255, 0.07);
    padding: 0.85rem;
    border-radius: 3px;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .h-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .h-icon-box {
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(234, 179, 8, 0.1);
    border-radius: 3px;
  }

  .h-label {
    font-size: 0.82rem;
    font-weight: 700;
    color: #fde047;
    letter-spacing: 0.03em;
  }

  .h-desc {
    margin: 0;
    font-size: 0.78rem;
    line-height: 1.45;
    color: #94a3b8;
  }

  /* Pro Tip */
  .pro-tip-box {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    background: rgba(56, 189, 248, 0.06);
    border: 1px solid rgba(56, 189, 248, 0.25);
    padding: 0.75rem 1rem;
    border-radius: 4px;
  }

  .tip-icon-box {
    padding-top: 2px;
  }

  .tip-text {
    margin: 0;
    font-size: 0.82rem;
    line-height: 1.45;
    color: #bae6fd;
    font-style: italic;
  }

  /* Footer */
  .tutorial-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1rem 1.5rem;
    background: rgba(10, 15, 25, 0.95);
    border-top: 1px solid rgba(255, 255, 255, 0.08);
  }

  .footer-left {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .practice-btn {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    font-size: 0.78rem;
    font-weight: 700;
    padding: 0.55rem 0.95rem;
    color: #38bdf8;
    border-color: rgba(56, 189, 248, 0.35);
    background: rgba(56, 189, 248, 0.08);
    cursor: pointer;
    border-radius: 3px;
    transition: all 0.15s ease;
  }
  .practice-btn:hover {
    background: rgba(56, 189, 248, 0.18);
    border-color: #38bdf8;
    color: #f8fafc;
  }

  .skip-btn {
    background: transparent;
    border: none;
    font-size: 0.78rem;
    font-weight: 600;
    color: #64748b;
    cursor: pointer;
    padding: 0.45rem 0.65rem;
    transition: color 0.15s ease;
  }
  .skip-btn:hover {
    color: #94a3b8;
  }

  .footer-right {
    display: flex;
    align-items: center;
    gap: 0.65rem;
  }

  .nav-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    padding: 0.55rem 1.15rem;
    font-size: 0.82rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    cursor: pointer;
    border-radius: 3px;
    transition: all 0.15s ease;
  }

  .prev-btn {
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.12);
    color: #cbd5e1;
  }
  .prev-btn:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.1);
    color: #f8fafc;
  }
  .prev-btn:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  .next-btn {
    background: linear-gradient(180deg, #ca8a04 0%, #a16207 100%);
    border: 1px solid #fde047;
    color: #050505;
    box-shadow: 0 0 12px rgba(234, 179, 8, 0.25);
  }
  .next-btn:hover {
    background: linear-gradient(180deg, #eab308 0%, #ca8a04 100%);
    box-shadow: 0 0 18px rgba(234, 179, 8, 0.4);
    transform: translateY(-1px);
  }

  .finish-btn {
    background: linear-gradient(180deg, #16a34a 0%, #15803d 100%);
    border: 1px solid #4ade80;
    color: #f8fafc;
    box-shadow: 0 0 12px rgba(34, 197, 94, 0.3);
  }
  .finish-btn:hover {
    background: linear-gradient(180deg, #22c55e 0%, #16a34a 100%);
    box-shadow: 0 0 18px rgba(34, 197, 94, 0.5);
  }

  @media (max-width: 680px) {
    .highlights-grid {
      grid-template-columns: 1fr;
    }
    .tutorial-stepper {
      grid-template-columns: repeat(3, 1fr);
    }
  }
</style>
