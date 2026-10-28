<script lang="ts">
  import type { Badge } from "@hegemonia/shared";
  import { i18n, t } from "../i18n/index.svelte";
  import { getBadgeName, getBadgeDescription } from "../i18n/content.svelte";
  import Icon from "./Icon.svelte";

  let { badges }: { badges: Badge[] } = $props();
</script>

<div class="badge-grid">
  {#each badges as badge}
    {@const name = getBadgeName(badge.slug, badge.name)}
    {@const description = getBadgeDescription(badge.slug, badge.description)}
    <article class:unlocked={badge.awardedAt} class="achievement" title={description}>
      <div class="achievement-icon"><Icon name={badge.icon} size={23} /></div>
      <div>
        <strong>{name}</strong>
        <p>{description}</p>
        <small>
          {badge.awardedAt
            ? t("badge_awarded_on", { date: i18n.formatDateShort(badge.awardedAt) })
            : t("badge_not_awarded")}
        </small>
      </div>
    </article>
  {:else}
    <p class="empty-state">{t("badge_empty")}</p>
  {/each}
</div>
