<script lang="ts">
  import type { LeaderboardRow } from "@hegemonia/shared";
  import { api, navigate } from "../lib/api";
  import { t } from "../i18n/index.svelte";
  import Avatar from "./Avatar.svelte";
  import Icon from "./Icon.svelte";

  let rows = $state<LeaderboardRow[]>([]);
  let loading = $state(true);
  let error = $state("");

  $effect(() => {
    api<{ leaderboard: LeaderboardRow[] }>("/api/leaderboard?limit=100")
      .then((result) => (rows = result.leaderboard))
      .catch((cause) => (error = cause instanceof Error ? cause.message : t("error_default")))
      .finally(() => (loading = false));
  });
</script>

<section class="panel leaderboard-panel">
  <div class="section-heading">
    <div>
      <span class="eyebrow">{t("lb_eyebrow")}</span>
      <h1>{t("lb_title")}</h1>
      <p>{t("lb_desc")}</p>
    </div>
    <Icon name="rank" size={34} />
  </div>

  {#if loading}
    <div class="loading-panel">{t("lb_loading")}</div>
  {:else if error}
    <p class="form-error">{error}</p>
  {:else}
    <div class="leaderboard-head">
      <span>{t("lb_col_position")}</span>
      <span>{t("lb_col_commander")}</span>
      <span>{t("lb_col_matches")}</span>
      <span>{t("lb_col_wins")}</span>
      <span>{t("lb_col_winrate")}</span>
      <span>{t("lb_col_score")}</span>
    </div>
    <div class="leaderboard-list">
      {#each rows as row}
        <button class="leaderboard-row" onclick={() => navigate(`/profile/${row.username}`)}>
          <strong class="rank-number">{String(row.rank).padStart(2, "0")}</strong>
          <span class="leader-person">
            <Avatar name={row.displayName} avatarUrl={row.avatarUrl} size="small" />
            <span>
              <strong>{row.displayName}</strong>
              <small>@{row.username}</small>
            </span>
          </span>
          <span>{row.matchesPlayed}</span>
          <span>{row.wins}</span>
          <span>{row.winRate !== null ? `${row.winRate.toFixed(1)}%` : "—"}</span>
          <strong class="score">{row.score}</strong>
        </button>
      {:else}
        <div class="empty-state leaderboard-empty">
          <Icon name="rank" size={32} />
          <h2>{t("lb_empty_title")}</h2>
          <p>{t("lb_empty_desc")}</p>
        </div>
      {/each}
    </div>
  {/if}
</section>
