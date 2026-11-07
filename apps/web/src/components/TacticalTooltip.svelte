<script lang="ts">
  import { ui } from "../lib/ui.svelte";

  const tip = $derived(ui.activeTooltip);
  const isNearTop = $derived(tip.y < 70);
</script>

{#if tip.visible && ui.tooltipsEnabled}
  <div
    class="tactical-tooltip"
    class:near-top={isNearTop}
    style="left: {tip.x}px; top: {tip.y}px;"
    role="tooltip"
  >
    <div class="tt-text">{tip.text}</div>
    {#if tip.subtext}
      <div class="tt-sub">{tip.subtext}</div>
    {/if}
  </div>
{/if}

<style>
  .tactical-tooltip {
    position: fixed;
    z-index: 99999;
    pointer-events: none;
    transform: translate(-50%, -100%) translateY(-8px);
    background: rgba(6, 11, 21, 0.96);
    border: 1px solid rgba(212, 175, 55, 0.45);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.85), 0 0 12px rgba(234, 179, 8, 0.15);
    border-radius: 4px;
    padding: 6px 11px;
    color: #f8fafc;
    font-family: var(--font-tactical);
    font-size: 0.76rem;
    line-height: 1.35;
    white-space: normal;
    max-width: 260px;
    backdrop-filter: blur(12px);
    animation: ttFadeIn 0.15s cubic-bezier(0.16, 1, 0.3, 1);
  }
  .tactical-tooltip.near-top {
    transform: translate(-50%, 0) translateY(12px);
    animation: ttFadeInDown 0.15s cubic-bezier(0.16, 1, 0.3, 1);
  }
  .tt-text {
    font-weight: 700;
    color: #fef08a;
    letter-spacing: 0.04em;
  }
  .tt-sub {
    font-size: 0.68rem;
    color: #cbd5e1;
    margin-top: 3px;
    font-family: var(--font-mono);
  }
  @keyframes ttFadeIn {
    from {
      opacity: 0;
      transform: translate(-50%, -92%) translateY(-8px);
    }
    to {
      opacity: 1;
      transform: translate(-50%, -100%) translateY(-8px);
    }
  }
  @keyframes ttFadeInDown {
    from {
      opacity: 0;
      transform: translate(-50%, 0) translateY(6px);
    }
    to {
      opacity: 1;
      transform: translate(-50%, 0) translateY(12px);
    }
  }
</style>
