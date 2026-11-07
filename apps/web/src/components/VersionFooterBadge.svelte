<script lang="ts">
  import { versionGuard, CLIENT_COMMIT_HASH } from "../lib/version.svelte";
  import { HEGEMONIA_VERSION } from "@hegemonia/shared";

  let copied = $state(false);
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const displayString = $derived(
    CLIENT_COMMIT_HASH && CLIENT_COMMIT_HASH !== "dev"
      ? `v${HEGEMONIA_VERSION} · ${CLIENT_COMMIT_HASH}`
      : `v${HEGEMONIA_VERSION}`
  );

  async function copyDiagnostic() {
    const srvCommit = versionGuard.serverCommitHash ?? CLIENT_COMMIT_HASH;
    const text = `Hegemonia v${HEGEMONIA_VERSION} (client:${CLIENT_COMMIT_HASH} | server:${srvCommit})`;

    try {
      await navigator.clipboard.writeText(text);
      copied = true;
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        copied = false;
      }, 2000);
    } catch {
      // Fallback para navegadores sem permissão de clipboard
    }
  }
</script>

<button
  class="version-footer-badge"
  onclick={copyDiagnostic}
  title="Versão do Hegemonia e Hash Git do deploy. Clique para copiar diagnóstico."
  aria-label="Versão do sistema"
>
  {#if copied}
    <span class="copied-indicator">Copiado!</span>
  {:else}
    <span class="version-text">{displayString}</span>
  {/if}
</button>

<style>
  .version-footer-badge {
    position: fixed;
    bottom: 6px;
    right: 12px;
    z-index: 50;
    display: inline-flex;
    align-items: center;
    padding: 2px 7px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 0.68rem;
    color: #64748b;
    background: rgba(15, 23, 42, 0.75);
    border: 1px solid rgba(148, 163, 184, 0.16);
    border-radius: 4px;
    backdrop-filter: blur(6px);
    cursor: pointer;
    user-select: none;
    transition: all 0.2s ease;
  }

  .version-footer-badge:hover {
    color: #cbd5e1;
    background: rgba(15, 23, 42, 0.95);
    border-color: rgba(234, 179, 8, 0.4);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
  }

  .version-text {
    letter-spacing: 0.03em;
  }

  .copied-indicator {
    color: #10b981;
    font-weight: 700;
  }

  @media (max-width: 640px) {
    .version-footer-badge {
      font-size: 0.6rem;
      bottom: 3px;
      right: 6px;
      padding: 1px 5px;
    }
  }
</style>
