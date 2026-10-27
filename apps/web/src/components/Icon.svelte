<script lang="ts">
  let { name, size = 18 }: { name: string; size?: number } = $props();
</script>
<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  {#if name === "user"}<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>
  {:else if name === "users"}<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>
  {:else if name === "rank"}<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H3v2a4 4 0 0 0 4 4M17 6h4v2a4 4 0 0 1-4 4"/>
  {:else if name === "back"}<path d="m15 18-6-6 6-6"/>
  {:else if name === "logout"}<path d="M10 17l5-5-5-5M15 12H3M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/>
  {:else if name === "settings"}<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.09A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3v-4h.09A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3h4v.09A1.7 1.7 0 0 0 15.4 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.16.38.37.72.6 1 .3.3.7.45 1.1.4h.09v4h-.09a1.7 1.7 0 0 0-1.7.6z"/>
  {:else if name === "shield"}<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
  {:else if name === "swords"}<path d="m14.5 17.5-11-11V3h3l11 11M13 19l6-6M16 16l4 4M9.5 17.5l11-11V3h-3l-11 11M5 13l6 6M4 20l4-4"/>
  {:else if name === "crown"}<path d="m2 18 3-11 4.5 5L12 5l2.5 7L19 7l3 11zM4 22h16"/>
  {:else if name === "star"}<path d="m12 2 3 6 7 .9-5 4.8 1.2 7-6.2-3.3-6.2 3.3 1.2-7-5-4.8L9 8z"/>
  {:else if name === "laurel"}<path d="M8 21c-5-3-6-9-3-15 4 2 6 6 5 10M16 21c5-3 6-9 3-15-4 2-6 6-5 10M8 21h8"/>
  {:else if name === "chevrons"}<path d="m6 9 6 6 6-6M6 3l6 6 6-6"/>
  {:else}<circle cx="12" cy="12" r="9"/>{/if}
</svg>
