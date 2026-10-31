<script lang="ts">
  import {
    calculateLevelProgress,
    type Badge,
    type FriendSummary,
    type PlayerStats,
    type PublicProfile,
  } from "@hegemonia/shared";
  import { api, navigate } from "../lib/api";
  import { auth } from "../lib/auth.svelte";
  import { i18n, t } from "../i18n/index.svelte";
  import { getFactionName } from "../i18n/content.svelte";
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
      error = cause instanceof Error ? cause.message : t("error_profile_not_found");
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
      error = cause instanceof Error ? cause.message : t("error_action_unavailable");
    }
  }

  function percent(value: number | null) {
    return value === null ? "—" : `${value.toFixed(1)}%`;
  }

  let profileLevelProgress = $derived(
    calculateLevelProgress(profile?.totalXp ?? 0)
  );
</script>

{#if loading}
  <div class="loading-panel">
    <span class="loader"></span> {t("profile_loading")}
  </div>
{:else if error && !profile}
  <div class="panel empty-state" style="text-align: center; padding: 48px;">
    <h2>{t("profile_unavailable_title")}</h2>
    <p style="margin: 10px 0 20px;">{error}</p>
    <button class="gold-button" onclick={() => navigate("/")}>{t("profile_btn_back_home")}</button>
  </div>
{:else if profile}
  <div class="profile-layout">
    <section class="profile-hero panel">
      <div class="profile-identity">
        <Avatar name={profile.displayName} avatarUrl={profile.avatarUrl} size="large" />
        <div>
          <span class="eyebrow">{t("profile_eyebrow")}</span>
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
          <div class="profile-level-badge" title={t("xp_level_tooltip", { level: profile.level || profileLevelProgress.level, xp: profile.totalXp })}>
            <span class="level-pill"><Icon name="rank" size={12} /> {t("xp_level_badge", { level: profile.level || profileLevelProgress.level })}</span>
            <span class="level-xp-text">{profile.totalXp} XP</span>
          </div>
          <p class="enlisted">
            {t("profile_commissioned_since", {
              date: i18n.formatDate(profile.createdAt, { month: "long", year: "numeric" }),
            })}
          </p>
        </div>
      </div>

      <div class="profile-actions">
        {#if profile.isSelf}
          <button class="outline-button" onclick={() => (editing = !editing)}>
            <Icon name="settings" size={14} />
            {editing ? t("profile_btn_close_edit") : t("profile_btn_edit")}
          </button>
        {:else if auth.user}
          {#if profile.relationship === "friends"}
            <button disabled><Icon name="check" size={14} /> {t("profile_btn_allies")}</button>
            <button class="text-button" onclick={() => relation("", "DELETE")}>
              {t("profile_btn_break_alliance")}
            </button>
          {:else if profile.relationship === "incoming"}
            <button class="gold-button" onclick={() => relation("accept")}>
              {t("profile_btn_accept_alliance")}
            </button>
          {:else if profile.relationship === "outgoing"}
            <button disabled>{t("profile_btn_request_sent")}</button>
          {:else if profile.relationship === "none"}
            <button class="gold-button" onclick={() => relation("request")}>
              {t("profile_btn_form_alliance")}
            </button>
          {/if}
          {#if profile.relationship !== "blocked"}
            <button class="text-button danger-text" onclick={() => relation("block")}>
              {t("profile_btn_block")}
            </button>
          {/if}
        {:else}
          <button class="gold-button" onclick={() => (auth.dialogOpen = true)}>
            {t("profile_btn_access_credentials")}
          </button>
        {/if}
      </div>

      {#if profile.bio}
        <p class="profile-bio">{profile.bio}</p>
      {/if}

      <div class="profile-meta">
        {#if !profile.isSelf}
          <span>
            <Icon name="users" size={15} />
            {t("profile_mutual_allies_count", { count: profile.mutualFriends })}
          </span>
        {/if}
        <span>
          <Icon name="shield" size={15} />
          {profile.relationship === "friends"
            ? t("profile_status_allied")
            : profile.isSelf
              ? t("profile_status_self")
              : t("profile_status_officer")}
        </span>
      </div>
    </section>

    {#if error}<p class="form-error">{error}</p>{/if}
    {#if editing && profile.isSelf}<ProfileEditor onsaved={() => void load()} />{/if}

    {#if profile.canViewStats && stats?.career}
      <section class="stats-grid">
        <article class="xp-stat-card">
          <span>{t("xp_level_badge", { level: profile.level || profileLevelProgress.level })}</span>
          <strong>{profile.totalXp} XP</strong>
          <small>{profileLevelProgress.xpInCurrentLevel} / {profileLevelProgress.xpNeededForNextLevel} XP ({profileLevelProgress.progressPct}%)</small>
        </article>
        <article>
          <span>{t("profile_stat_campaigns")}</span>
          <strong>{stats.career.matchesPlayed}</strong>
          <small>{t("profile_stat_campaigns_sub")}</small>
        </article>
        <article>
          <span>{t("profile_stat_wins")}</span>
          <strong>{stats.career.wins}</strong>
          <small>{t("profile_stat_losses_sub", { count: stats.career.losses })}</small>
        </article>
        <article>
          <span>{t("profile_stat_efficiency")}</span>
          <strong>{percent(stats.career.winRate)}</strong>
          <small>{t("profile_stat_efficiency_sub")}</small>
        </article>
        <article>
          <span>{t("profile_stat_streak")}</span>
          <strong>{stats.career.currentWinStreak}</strong>
          <small>{t("profile_stat_streak_sub")}</small>
        </article>
      </section>

      <div class="profile-columns">
        <section class="panel">
          <div class="section-heading">
            <div>
              <span class="eyebrow">{t("profile_decorations_eyebrow")}</span>
              <h2>{t("profile_decorations_title")}</h2>
            </div>
            <span>{badges.filter((b) => b.awardedAt).length}/{badges.length}</span>
          </div>
          <BadgeGrid {badges} />
        </section>

        <section class="panel">
          <div class="section-heading">
            <div>
              <span class="eyebrow">{t("profile_factions_eyebrow")}</span>
              <h2>{t("profile_factions_title")}</h2>
            </div>
          </div>
          <div class="breakdown-list">
            {#each stats.byColor as row}
              <div class="breakdown-row">
                <div>
                  <strong>{row.color ? getFactionName(row.color) : "—"}</strong>
                  <small>{t("profile_factions_wins_in_matches", { wins: row.wins, matches: row.matchesPlayed })}</small>
                </div>
                <span>{percent(row.winRate)}</span>
                <div class="stat-bar"><i style={`width:${row.winRate ?? 0}%`}></i></div>
              </div>
            {:else}
              <p class="empty-state">{t("profile_factions_empty")}</p>
            {/each}
          </div>
        </section>
      </div>

      <section class="panel">
        <div class="section-heading">
          <div>
            <span class="eyebrow">{t("profile_history_eyebrow")}</span>
            <h2>{t("profile_history_title")}</h2>
          </div>
        </div>
        <div class="match-list">
          {#each matches as match}
            <article class="match-row">
              <span class:match-win={match.result === "win"} class="match-result">
                {match.result === "win" ? t("profile_result_win") : t("profile_result_defeat")}
              </span>
              <div>
                <strong>{match.mapId === "classic" ? t("profile_classic_theatre") : match.mapId} · {match.gameMode}</strong>
                <small>
                  {i18n.formatDateShort(match.endedAt)} {i18n.formatTimeShort(match.endedAt)} · {t("profile_operation_code", { code: match.roomCode })}
                </small>
              </div>
              <span>#{match.placement}</span>
              <span>{t("profile_territories_count", { count: match.finalTerritories })}</span>
            </article>
          {:else}
            <p class="empty-state">{t("profile_history_empty")}</p>
          {/each}
        </div>
      </section>

      {#if mutual.length}
        <section class="panel">
          <div class="section-heading">
            <div>
              <span class="eyebrow">{t("profile_mutual_eyebrow")}</span>
              <h2>{t("profile_mutual_title")}</h2>
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
        <h2>{t("profile_classified_title")}</h2>
        <p>{t("profile_classified_desc")}</p>
      </section>
    {/if}
  </div>
{/if}

<style>
  .profile-level-badge {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    margin-top: 4px;
  }
  .level-pill {
    background: rgba(56, 189, 248, 0.18);
    color: #bae6fd;
    border: 1px solid rgba(56, 189, 248, 0.45);
    font-family: var(--font-tactical);
    font-size: 0.65rem;
    font-weight: 800;
    letter-spacing: 0.08em;
    padding: 2px 7px;
    border-radius: 3px;
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .level-xp-text {
    font-family: var(--font-mono);
    font-size: 0.72rem;
    color: #fde047;
    font-weight: 700;
  }
  .xp-stat-card {
    border-color: rgba(56, 189, 248, 0.35);
  }
</style>
