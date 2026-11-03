<script lang="ts">
  import { DOCTRINES, type DoctrineId } from "@hegemonia/shared";
  import { i18n } from "../i18n/index.svelte";

  let {
    doctrineId,
    size = 24,
    showLabel = false,
  }: {
    doctrineId?: DoctrineId | null;
    size?: number;
    showLabel?: boolean;
  } = $props();

  let def = $derived(doctrineId ? DOCTRINES[doctrineId] : null);
  let titleText = $derived(
    def
      ? `${i18n.locale === "en" ? def.nameEn : def.namePt} — ${i18n.locale === "en" ? def.summaryEn : def.summaryPt}`
      : "",
  );
</script>

{#if def}
  <span
    class="doctrine-crest-wrap"
    style="--doc-color: {def.accentColor};"
    title={titleText}
  >
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      class="doctrine-crest-svg"
      aria-label={i18n.locale === "en" ? def.nameEn : def.namePt}
    >
      <!-- Escudo Heráldico Base -->
      <path
        d="M16 2 L28 6 V15 C28 22.5 22.8 27.8 16 30 C9.2 27.8 4 22.5 4 15 V6 Z"
        fill="#080e1a"
        stroke={def.accentColor}
        stroke-width="2"
      />
      <path
        d="M16 4.5 L25.5 7.8 V14.8 C25.5 20.8 21.3 25.2 16 27.2 C10.7 25.2 6.5 20.8 6.5 14.8 V7.8 Z"
        fill={def.accentColor}
        fill-opacity="0.16"
      />

      {#if def.id === "blitzkrieg"}
        <!-- Divisa Blindada + Raio de Choque -->
        <polygon
          points="17,7 11,16 16,16 14,25 22,14 17,14"
          fill={def.accentColor}
        />
      {:else if def.id === "defense_in_depth"}
        <!-- Torre de Fortaleza / Baluarte Simétrico e Centralizado -->
        <path
          d="M9.5 9.5 H12.2 V11.8 H14.6 V9.5 H17.4 V11.8 H19.8 V9.5 H22.5 V13.2 H20.8 V20.5 H17.8 V17.2 C17.8 16.2 17 15.4 16 15.4 C15 15.4 14.2 16.2 14.2 17.2 V20.5 H11.2 V13.2 H9.5 Z"
          fill={def.accentColor}
        />
        <!-- Seteira Central Superior -->
        <rect
          x="15.25"
          y="12.2"
          width="1.5"
          height="2"
          rx="0.4"
          fill="#080e1a"
        />
        <!-- Base da Fortaleza -->
        <line
          x1="8.5"
          y1="22"
          x2="23.5"
          y2="22"
          stroke={def.accentColor}
          stroke-width="1.8"
          stroke-linecap="round"
        />
      {:else if def.id === "fleet_in_being"}
        <!-- Âncora Aeronaval & Asas -->
        <circle
          cx="16"
          cy="10"
          r="2"
          stroke={def.accentColor}
          stroke-width="1.8"
          fill="none"
        />
        <line
          x1="16"
          y1="12"
          x2="16"
          y2="23"
          stroke={def.accentColor}
          stroke-width="2"
        />
        <path
          d="M10 15 H22 M11 19 C11 22 21 22 21 19"
          stroke={def.accentColor}
          stroke-width="1.8"
          fill="none"
        />
      {:else if def.id === "guerrilla_warfare"}
        <!-- Estrela Partisan & Sabres Cruzados -->
        <path
          d="M11 22 L21 10 M21 22 L11 10"
          stroke={def.accentColor}
          stroke-width="2"
          stroke-linecap="round"
        />
        <polygon
          points="16,8 17.4,12.2 21.8,12.2 18.2,14.8 19.5,19 16,16.4 12.5,19 13.8,14.8 10.2,12.2 14.6,12.2"
          fill={def.accentColor}
        />
      {/if}
    </svg>

    {#if showLabel}
      <span class="doctrine-crest-label">
        <strong>{def.badgeCode}</strong>
        <small
          >{i18n.locale === "en"
            ? def.nameEn.split(" (")[0]
            : def.namePt.split(" (")[0]}</small
        >
      </span>
    {/if}
  </span>
{/if}

<style>
  .doctrine-crest-wrap {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    vertical-align: middle;
    cursor: help;
  }
  .doctrine-crest-svg {
    display: block;
    filter: drop-shadow(0 2px 6px rgba(0, 0, 0, 0.75));
    flex-shrink: 0;
  }
  .doctrine-crest-label {
    display: inline-flex;
    align-items: baseline;
    gap: 0.28rem;
    padding: 2px 6px;
    border-radius: 4px;
    background: rgba(8, 14, 26, 0.88);
    border: 1px solid var(--doc-color, #eab308);
    font-family: var(--font-tactical);
  }
  .doctrine-crest-label strong {
    font-family: var(--font-mono);
    font-size: 0.64rem;
    color: var(--doc-color, #fde047);
    letter-spacing: 0.08em;
  }
  .doctrine-crest-label small {
    font-size: 0.68rem;
    color: #e2e8f0;
    font-weight: 700;
  }
</style>
