<script lang="ts">
  import type { Badge } from "@hegemonia/shared";
  import Icon from "./Icon.svelte";
  let { badges }: { badges: Badge[] } = $props();
</script>

<div class="badge-grid">
  {#each badges as badge}
    <article class:unlocked={badge.awardedAt} class="achievement" title={badge.description}>
      <div class="achievement-icon"><Icon name={badge.icon} size={23}/></div>
      <div><strong>{badge.name}</strong><p>{badge.description}</p><small>{badge.awardedAt ? `Conquistada em ${new Date(badge.awardedAt).toLocaleDateString("pt-BR")}` : "Ainda não conquistada"}</small></div>
    </article>
  {:else}
    <p class="empty-state">Nenhuma conquista disponível.</p>
  {/each}
</div>
