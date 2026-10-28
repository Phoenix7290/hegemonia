<script lang="ts">
  import type { LeaderboardRow } from "@hegemonia/shared";
  import { api, navigate } from "../lib/api";
  import Avatar from "./Avatar.svelte";
  import Icon from "./Icon.svelte";
  let rows = $state<LeaderboardRow[]>([]);
  let loading = $state(true);
  let error = $state("");
  $effect(() => {
    api<{ leaderboard: LeaderboardRow[] }>("/api/leaderboard?limit=100").then((result) => rows = result.leaderboard).catch((cause) => error = cause.message).finally(() => loading = false);
  });
</script>

<section class="panel leaderboard-panel">
  <div class="section-heading"><div><span class="eyebrow">CARREIRA COMPETITIVA</span><h1>Classificação global</h1><p>Pontuação por vitórias ranqueadas, com desempate por total de conquistas.</p></div><Icon name="rank" size={34}/></div>
  {#if loading}<div class="loading-panel">Consolidando registros...</div>{:else if error}<p class="form-error">{error}</p>{:else}
    <div class="leaderboard-head"><span>POSIÇÃO</span><span>COMANDANTE</span><span>PARTIDAS</span><span>VITÓRIAS</span><span>APROVEITAMENTO</span><span>PONTOS</span></div>
    <div class="leaderboard-list">{#each rows as row}<button class="leaderboard-row" onclick={() => navigate(`/profile/${row.username}`)}><strong class="rank-number">{String(row.rank).padStart(2, "0")}</strong><span class="leader-person"><Avatar name={row.displayName} avatarUrl={row.avatarUrl} size="small"/><span><strong>{row.displayName}</strong><small>@{row.username}</small></span></span><span>{row.matchesPlayed}</span><span>{row.wins}</span><span>{row.winRate?.toFixed(1) ?? "—"}%</span><strong class="score">{row.score}</strong></button>{:else}<div class="empty-state leaderboard-empty"><Icon name="rank" size={32}/><h2>O ranking aguarda suas primeiras campanhas</h2><p>Partidas casuais continuam contando para suas estatísticas e conquistas.</p></div>{/each}</div>
  {/if}
</section>
