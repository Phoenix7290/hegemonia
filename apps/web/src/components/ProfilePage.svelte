<script lang="ts">
  import type { Badge, FriendSummary, PlayerStats, PublicProfile } from "@hegemonia/shared";
  import { api, navigate } from "../lib/api";
  import { auth } from "../lib/auth.svelte";
  import Avatar from "./Avatar.svelte";
  import BadgeGrid from "./BadgeGrid.svelte";
  import Icon from "./Icon.svelte";
  import ProfileEditor from "./ProfileEditor.svelte";

  let { username }: { username: string } = $props();
  let profile = $state<PublicProfile | null>(null);
  let badges = $state<Badge[]>([]);
  let stats = $state<PlayerStats | null>(null);
  let matches = $state<any[]>([]);
  let mutual = $state<FriendSummary[]>([]);
  let loading = $state(true);
  let error = $state("");
  let editing = $state(new URLSearchParams(window.location.search).has("edit"));

  const COLOR_LABELS_PT: Record<string, string> = {
    blue: "União Atlântica (Azul)",
    red: "Diretório Vermelho",
    green: "Pacto Esmeralda (Verde)",
    yellow: "Império Áureo (Amarelo)",
    black: "Legião de Ferro (Preto)",
    white: "Coalizão Boreal (Branco)",
  };

  async function load(_targetUsername = username) {
    loading = true;
    error = "";
    try {
      const result = await api<{ profile: PublicProfile; badges: Badge[] }>(
        `/api/profiles/${encodeURIComponent(username)}`
      );
      profile = result.profile;
      badges = result.badges;
      stats = null;
      matches = [];
      mutual = [];
      if (profile.canViewStats) {
        [stats, { matches }] = await Promise.all([
          api<PlayerStats>(`/api/profiles/${encodeURIComponent(username)}/stats`),
          api<{ matches: any[] }>(`/api/profiles/${encodeURIComponent(username)}/matches`),
        ]);
      }
      if (auth.user && !profile.isSelf && profile.relationship !== "blocked") {
        const result = await api<{ friends: FriendSummary[] }>(
          `/api/profiles/${encodeURIComponent(username)}/mutual`
        );
        mutual = result.friends;
      }
    } catch (cause) {
      error = cause instanceof Error ? cause.message : "Perfil indisponível.";
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    void load(username);
  });

  async function relation(action: string, method = "POST") {
    if (!profile) return;
    try {
      await api<void>(`/api/friends/${profile.id}/${action}`, { method });
      await load();
    } catch (cause) {
      error = cause instanceof Error ? cause.message : "Ação indisponível.";
    }
  }

  function percent(value: number | null) {
    return value === null ? "—" : `${value.toFixed(1)}%`;
  }
</script>

{#if loading}
  <div class="loading-panel">
    <span class="loader"></span> Consultando arquivo do comandante...
  </div>
{:else if error && !profile}
  <div class="panel empty-state" style="text-align: center; padding: 48px;">
    <h2>Registro Militar Indisponível</h2>
    <p style="margin: 10px 0 20px;">{error}</p>
    <button class="gold-button" onclick={() => navigate("/")}>Voltar ao Comando</button>
  </div>
{:else if profile}
  <div class="profile-layout">
    <section class="profile-hero panel">
      <div class="profile-identity">
        <Avatar name={profile.displayName} avatarUrl={profile.avatarUrl} size="large" />
        <div>
          <span class="eyebrow">DOSSIÊ OFICIAL DO COMANDANTE</span>
          <h1>{profile.displayName}</h1>
          <a
            class="username"
            href={`/profile/${profile.username}`}
            onclick={(e) => {
              e.preventDefault();
            }}
          >
            @{profile.username}
          </a>
          <p class="enlisted">
            Comissionado desde {new Date(profile.createdAt).toLocaleDateString("pt-BR", {
              month: "long",
              year: "numeric",
            })}
          </p>
        </div>
      </div>

      <div class="profile-actions">
        {#if profile.isSelf}
          <button class="outline-button" onclick={() => (editing = !editing)}>
            <Icon name="settings" size={14} />
            {editing ? "Fechar Edição" : "Editar Dossiê"}
          </button>
        {:else if auth.user}
          {#if profile.relationship === "friends"}
            <button disabled><Icon name="check" size={14} /> Aliados</button>
            <button class="text-button" onclick={() => relation("", "DELETE")}>
              Romper Aliança
            </button>
          {:else if profile.relationship === "incoming"}
            <button class="gold-button" onclick={() => relation("accept")}>
              Aceitar Aliança
            </button>
          {:else if profile.relationship === "outgoing"}
            <button disabled>Proposta Enviada</button>
          {:else if profile.relationship === "none"}
            <button class="gold-button" onclick={() => relation("request")}>
              Propor Aliança
            </button>
          {/if}
          {#if profile.relationship !== "blocked"}
            <button class="text-button danger-text" onclick={() => relation("block")}>
              Bloquear
            </button>
          {/if}
        {:else}
          <button class="gold-button" onclick={() => (auth.dialogOpen = true)}>
            Autenticar para Propor Aliança
          </button>
        {/if}
      </div>

      {#if profile.bio}
        <p class="profile-bio">{profile.bio}</p>
      {/if}

      <div class="profile-meta">
        {#if !profile.isSelf}
          <span><Icon name="users" size={15} /> {profile.mutualFriends} aliados em comum</span>
        {/if}
        <span>
          <Icon name="shield" size={15} />
          {profile.relationship === "friends"
            ? "Aliado Estratégico Confirmado"
            : profile.isSelf
              ? "Seu Registro Oficial"
              : "Oficial General — Hegemonia"}
        </span>
      </div>
    </section>

    {#if error}<p class="form-error">{error}</p>{/if}
    {#if editing && profile.isSelf}<ProfileEditor onsaved={() => void load()} />{/if}

    {#if profile.canViewStats && stats?.career}
      <section class="stats-grid">
        <article>
          <span>CAMPANHAS</span>
          <strong>{stats.career.matchesPlayed}</strong>
          <small>operações concluídas</small>
        </article>
        <article>
          <span>VITÓRIAS</span>
          <strong>{stats.career.wins}</strong>
          <small>{stats.career.losses} baixas estratégicas</small>
        </article>
        <article>
          <span>EFICIÊNCIA TÁTICA</span>
          <strong>{percent(stats.career.winRate)}</strong>
          <small>aproveitamento global</small>
        </article>
        <article>
          <span>SÉRIE VITORIOSA</span>
          <strong>{stats.career.currentWinStreak}</strong>
          <small>vitórias consecutivas</small>
        </article>
      </section>

      <div class="profile-columns">
        <section class="panel">
          <div class="section-heading">
            <div>
              <span class="eyebrow">MEDALHAS DE CAMPANHA</span>
              <h2>Condecorações</h2>
            </div>
            <span>{badges.filter((b) => b.awardedAt).length}/{badges.length}</span>
          </div>
          <BadgeGrid {badges} />
        </section>

        <section class="panel">
          <div class="section-heading">
            <div>
              <span class="eyebrow">DESEMPENHO POR EXÉRCITO</span>
              <h2>Histórico de Facções</h2>
            </div>
          </div>
          <div class="breakdown-list">
            {#each stats.byColor as row}
              <div class="breakdown-row">
                <div>
                  <strong>{row.color ? (COLOR_LABELS_PT[row.color] ?? row.color) : "Indefinido"}</strong>
                  <small>{row.wins} vitórias em {row.matchesPlayed} campanhas</small>
                </div>
                <span>{percent(row.winRate)}</span>
                <div class="stat-bar"><i style={`width:${row.winRate ?? 0}%`}></i></div>
              </div>
            {:else}
              <p class="empty-state">Conclua operações para registrar desempenho por facção militar.</p>
            {/each}
          </div>
        </section>
      </div>

      <section class="panel">
        <div class="section-heading">
          <div>
            <span class="eyebrow">HISTÓRICO OPERACIONAL</span>
            <h2>Campanhas Recentes</h2>
          </div>
        </div>
        <div class="match-list">
          {#each matches as match}
            <article class="match-row">
              <span class:match-win={match.result === "win"} class="match-result">
                {match.result === "win" ? "VITÓRIA" : "DERROTA"}
              </span>
              <div>
                <strong>{match.mapId === "classic" ? "Teatro Global (44 Regiões)" : match.mapId} · {match.gameMode}</strong>
                <small>{new Date(match.endedAt).toLocaleString("pt-BR")} · Operação {match.roomCode}</small>
              </div>
              <span>#{match.placement}</span>
              <span>{match.finalTerritories} territórios</span>
            </article>
          {:else}
            <p class="empty-state">Nenhuma campanha concluída até o momento.</p>
          {/each}
        </div>
      </section>

      {#if mutual.length}
        <section class="panel">
          <div class="section-heading">
            <div>
              <span class="eyebrow">COALIZÃO COMPARTILHADA</span>
              <h2>Aliados em Comum</h2>
            </div>
          </div>
          <div class="mutual-list">
            {#each mutual as friend}
              <button onclick={() => navigate(`/profile/${friend.username}`)}>
                <Avatar name={friend.displayName} avatarUrl={friend.avatarUrl} size="small" />
                <span>
                  {friend.displayName}
                  <small>@{friend.username}</small>
                </span>
              </button>
            {/each}
          </div>
        </section>
      {/if}
    {:else if !editing}
      <section class="panel private-profile">
        <Icon name="lock" size={32} />
        <h2>Dossiê Classificado</h2>
        <p>Este comandante restringiu o acesso público às suas estatísticas, condecorações e relatórios de campanha.</p>
      </section>
    {/if}
  </div>
{/if}
