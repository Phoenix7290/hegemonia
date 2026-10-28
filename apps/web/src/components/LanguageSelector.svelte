<script lang="ts">
  import { i18n } from "../i18n/index.svelte";
  import Icon from "./Icon.svelte";

  let { compact = false }: { compact?: boolean } = $props();
</script>

<div class="lang-selector" class:compact role="group" aria-label="Idioma / Language">
  <Icon name="globe" size={13} />
  <button
    type="button"
    class="lang-btn"
    class:active={i18n.locale === "pt-BR"}
    onclick={() => i18n.setLocale("pt-BR")}
    title="Português (Brasil)"
    aria-pressed={i18n.locale === "pt-BR"}
  >
    PT
  </button>
  <span class="lang-divider">/</span>
  <button
    type="button"
    class="lang-btn"
    class:active={i18n.locale === "en"}
    onclick={() => i18n.setLocale("en")}
    title="English (US)"
    aria-pressed={i18n.locale === "en"}
  >
    EN
  </button>
</div>

<style>
  .lang-selector {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 3px 8px;
    background: rgba(15, 23, 42, 0.7);
    border: 1px solid rgba(212, 175, 55, 0.25);
    border-radius: 4px;
    color: #94a3b8;
    font-family: var(--font-mono, monospace);
    font-size: 0.75rem;
    line-height: 1;
    user-select: none;
    transition: border-color 0.15s ease, background-color 0.15s ease;
  }

  .lang-selector:hover {
    border-color: rgba(212, 175, 55, 0.5);
    background: rgba(15, 23, 42, 0.9);
  }

  .lang-btn {
    background: none;
    border: none;
    padding: 2px 4px;
    color: #64748b;
    font-family: inherit;
    font-size: 0.72rem;
    font-weight: 600;
    letter-spacing: 0.05em;
    cursor: pointer;
    border-radius: 2px;
    transition: color 0.15s ease, background 0.15s ease;
  }

  .lang-btn:hover {
    color: #e2e8f0;
  }

  .lang-btn.active {
    color: #fbbf24;
    background: rgba(234, 179, 8, 0.12);
    font-weight: 700;
  }

  .lang-divider {
    color: #475569;
    font-size: 0.7rem;
  }

  .compact {
    padding: 2px 6px;
    font-size: 0.7rem;
  }
</style>
