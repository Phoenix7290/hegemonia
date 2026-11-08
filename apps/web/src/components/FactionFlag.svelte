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
    <polygon points="12,2 14,6 18,8 14,10 12,14 10,10 6,8 10,6" fill="#F0F0F5" />
  {:else if color === "red"}
    <rect width="24" height="16" fill="#b91c1c" />
    <path d="M0,0 L24,16 M24,0 L0,16" stroke="#fca5a5" stroke-width="2.2" opacity="0.5" />
    <polygon points="12,3 16,8 12,13 8,8" fill="#facc15" stroke="#7f1d1d" stroke-width="0.8" />
  {:else if color === "green"}
    <rect width="24" height="16" fill="#10b981" />
    <polygon points="0,0 10,8 0,16" fill="#065f46" />
    <polygon points="0,0 10,8 0,16" fill="none" stroke="#fcd34d" stroke-width="1.2" />
    <circle cx="15.5" cy="8" r="3.5" fill="none" stroke="#ecfdf5" stroke-width="1.5" />
  {:else if color === "dark_green"}
    <rect width="24" height="16" fill="#14532d" />
    <rect y="6" width="24" height="4" fill="#15803d" />
    <polygon points="12,2.5 15,8 12,13.5 9,8" fill="#86efac" />
  {:else if color === "yellow"}
    <rect width="24" height="16" fill="#eab308" />
    <rect y="0" width="24" height="3.5" fill="#1e293b" />
    <rect y="12.5" width="24" height="3.5" fill="#1e293b" />
    <circle cx="12" cy="8" r="3.2" fill="#fef08a" stroke="#21262B" stroke-width="1" />
  {:else if color === "orange"}
    <rect width="24" height="16" fill="#ea580c" />
    <polygon points="0,0 24,0 12,8" fill="#fdba74" opacity="0.35" />
    <circle cx="12" cy="8" r="3.4" fill="#ffedd5" stroke="#7c2d12" stroke-width="1" />
  {:else if color === "pink"}
    <rect width="24" height="16" fill="#db2777" />
    <path d="M0,8 H24 M12,0 V16" stroke="#fbcfe8" stroke-width="2.4" opacity="0.55" />
    <polygon points="12,3 15.5,8 12,13 8.5,8" fill="#fdf2f8" />
  {:else if color === "purple"}
    <rect width="24" height="16" fill="#7e22ce" />
    <rect y="5.5" width="24" height="5" fill="#a855f7" opacity="0.55" />
    <circle cx="12" cy="8" r="3.3" fill="#f3e8ff" stroke="#3b0764" stroke-width="1" />
  {:else if color === "black"}
    <rect width="24" height="16" fill="#21262B" />
    <path d="M0,8 H24 M12,0 V16" stroke="#cbd5e1" stroke-width="3.2" />
    <path d="M0,8 H24 M12,0 V16" stroke="#21262B" stroke-width="1.4" />
    <rect x="9.5" y="5.5" width="5" height="5" fill="#F0F0F5" />
  {:else}
    <rect width="24" height="16" fill="#F0F0F5" />
    <path d="M0,8 H24 M9,0 V16" stroke="#21262B" stroke-width="3" />
    <circle cx="9" cy="8" r="2.2" fill="#f59e0b" />
  {/if}
  <rect width="24" height="16" fill="none" stroke="rgba(255,255,255,0.38)" stroke-width="1" />
</svg>
