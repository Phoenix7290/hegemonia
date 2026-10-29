<script lang="ts">
  import { resolveIconShapes, type IconName } from "../lib/icons";

  let {
    name,
    size = 18,
    x,
    y,
    color,
    strokeWidth = 1.85,
    class: className = "",
  }: {
    name: IconName;
    size?: number;
    x?: number;
    y?: number;
    color?: string;
    strokeWidth?: number;
    class?: string;
  } = $props();

  let shapes = $derived(resolveIconShapes(name));
</script>

<svg
  width={size}
  height={size}
  {x}
  {y}
  viewBox="0 0 24 24"
  fill="none"
  stroke={color ?? "currentColor"}
  stroke-width={strokeWidth}
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
  class="heg-icon {className}"
>
  {#each shapes as shape}
    {#if shape.tag === "path"}
      <path {...shape.attrs} />
    {:else if shape.tag === "circle"}
      <circle {...shape.attrs} />
    {:else if shape.tag === "rect"}
      <rect {...shape.attrs} />
    {:else if shape.tag === "line"}
      <line {...shape.attrs} />
    {:else if shape.tag === "polyline"}
      <polyline {...shape.attrs} />
    {:else if shape.tag === "polygon"}
      <polygon {...shape.attrs} />
    {/if}
  {/each}
</svg>

<style>
  .heg-icon {
    display: inline-block;
    vertical-align: middle;
    flex-shrink: 0;
  }
</style>
