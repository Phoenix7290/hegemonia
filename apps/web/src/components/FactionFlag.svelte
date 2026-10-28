<script lang="ts">
  import type { PlayerColor } from "@hegemonia/shared";

  let {
    color,
    width = 22,
    height = 14,
  }: { color: PlayerColor; width?: number; height?: number } = $props();
</script>

<svg
  {width}
  {height}
  viewBox="0 0 24 16"
  class="faction-flag-svg"
  style="border-radius: 2px; box-shadow: 0 1px 4px rgba(0,0,0,0.8); flex-shrink: 0;"
>
  {#if color === "blue"}
    <rect width="24" height="16" fill="#1d4ed8" />
    <rect y="6.5" width="24" height="3" fill="#93c5fd" opacity="0.45" />
    <rect x="10.5" width="3" height="16" fill="#93c5fd" opacity="0.45" />
    <polygon points="12,2 14,6 18,8 14,10 12,14 10,10 6,8 10,6" fill="#f8fafc" />
  {:else if color === "red"}
    <rect width="24" height="16" fill="#b91c1c" />
    <path d="M0,0 L24,16 M24,0 L0,16" stroke="#fca5a5" stroke-width="2.2" opacity="0.5" />
    <polygon points="12,3 16,8 12,13 8,8" fill="#facc15" stroke="#7f1d1d" stroke-width="0.8" />
  {:else if color === "green"}
    <rect width="24" height="16" fill="#047857" />
    <polygon points="0,0 10,8 0,16" fill="#064e3b" />
    <polygon points="0,0 10,8 0,16" fill="none" stroke="#fcd34d" stroke-width="1.2" />
    <circle cx="15.5" cy="8" r="3.5" fill="none" stroke="#ecfdf5" stroke-width="1.5" />
  {:else if color === "yellow"}
    <rect width="24" height="16" fill="#d97706" />
    <rect y="0" width="24" height="4" fill="#1e293b" />
    <rect y="12" width="24" height="4" fill="#1e293b" />
    <circle cx="12" cy="8" r="3.2" fill="#fef08a" stroke="#0f172a" stroke-width="1" />
  {:else if color === "black"}
    <rect width="24" height="16" fill="#1e293b" />
    <path d="M0,8 H24 M12,0 V16" stroke="#94a3b8" stroke-width="3.2" />
    <path d="M0,8 H24 M12,0 V16" stroke="#0f172a" stroke-width="1.4" />
    <rect x="9.5" y="5.5" width="5" height="5" fill="#e2e8f0" />
  {:else}
    <rect width="24" height="16" fill="#e2e8f0" />
    <path d="M0,8 H24 M9,0 V16" stroke="#334155" stroke-width="3" />
    <circle cx="9" cy="8" r="2.2" fill="#f59e0b" />
  {/if}
  <rect width="24" height="16" fill="none" stroke="rgba(255,255,255,0.38)" stroke-width="1" />
</svg>
