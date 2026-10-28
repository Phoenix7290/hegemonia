<script lang="ts">
  import type { FriendSummary } from "@hegemonia/shared";
  import { api, navigate } from "../lib/api";
  import { t } from "../i18n/index.svelte";
  import Avatar from "./Avatar.svelte";
  import UserSearch from "./UserSearch.svelte";

  let friends = $state<FriendSummary[]>([]);
  let incoming = $state<FriendSummary[]>([]);
  let outgoing = $state<FriendSummary[]>([]);
  let blocked = $state<FriendSummary[]>([]);
  let loading = $state(true);
  let error = $state("");

  async function load() {
    try {
      const [f, r, b] = await Promise.all([
        api<{ friends: FriendSummary[] }>("/api/friends"),
        api<{ incoming: FriendSummary[]; outgoing: FriendSummary[] }>("/api/friends/requests"),
        api<{ blocked: FriendSummary[] }>("/api/friends/blocked"),
      ]);
      friends = f.friends;
      incoming = r.incoming;
      outgoing = r.outgoing;
      blocked = b.blocked;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : t("error_social_unavailable");
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    void load();
  });

  async function act(id: string, action = "", method = "POST") {
    try {
      await api<void>(`/api/friends/${id}${action ? `/${action}` : ""}`, { method });
      await load();
    } catch (cause) {
      error = cause instanceof Error ? cause.message : t("error_action_unavailable");
    }
  }
</script>

{#snippet person(user: FriendSummary)}
  <button class="person-link" onclick={() => navigate(`/profile/${user.username}`)}>
    <Avatar name={user.displayName} avatarUrl={user.avatarUrl} />
    <span>
      <strong>{user.displayName}</strong>
      <small>@{user.username}</small>
    </span>
  </button>
{/snippet}

<div class="friends-layout">
  <section class="panel">
    <div class="section-heading">
      <div>
        <span class="eyebrow">{t("friends_eyebrow_search")}</span>
        <h1>{t("friends_title_search")}</h1>
      </div>
    </div>
    <UserSearch onchanged={() => void load()} />
  </section>

  {#if error}<p class="form-error">{error}</p>{/if}

  {#if loading}
    <div class="loading-panel">{t("friends_loading")}</div>
  {:else}
    <section class="panel">
      <div class="section-heading">
        <div>
          <span class="eyebrow">{t("friends_eyebrow_requests")}</span>
          <h2>{t("friends_title_pending")}</h2>
        </div>
        <span>{incoming.length}</span>
      </div>
      <div class="people-list">
        {#each incoming as user}
          <article class="person-row">
            {@render person(user)}
            <div class="row-actions">
              <button class="gold-button" onclick={() => act(user.id, "accept")}>
                {t("friends_btn_accept")}
              </button>
              <button class="outline-button" onclick={() => act(user.id, "decline")}>
                {t("friends_btn_decline")}
              </button>
            </div>
          </article>
        {:else}
          <p class="empty-state">{t("friends_empty_requests")}</p>
        {/each}
      </div>

      {#if outgoing.length}
        <h3 class="subsection-title">{t("friends_outgoing_title")}</h3>
        <div class="people-list">
          {#each outgoing as user}
            <article class="person-row">
              {@render person(user)}
              <button class="text-button" onclick={() => act(user.id, "", "DELETE")}>
                {t("friends_btn_cancel_request")}
              </button>
            </article>
          {/each}
        </div>
      {/if}
    </section>

    <section class="panel">
      <div class="section-heading">
        <div>
          <span class="eyebrow">{t("friends_eyebrow_confirmed")}</span>
          <h2>{t("friends_title_my_friends")}</h2>
        </div>
        <span>{friends.length}</span>
      </div>
      <div class="people-list">
        {#each friends as user}
          <article class="person-row">
            {@render person(user)}
            <div class="row-actions">
              <button class="outline-button" onclick={() => navigate(`/profile/${user.username}`)}>
                {t("friends_btn_view_profile")}
              </button>
              <button class="text-button" onclick={() => act(user.id, "", "DELETE")}>
                {t("friends_btn_remove")}
              </button>
            </div>
          </article>
        {:else}
          <p class="empty-state">{t("friends_empty_confirmed")}</p>
        {/each}
      </div>
    </section>

    <section class="panel">
      <div class="section-heading">
        <div>
          <span class="eyebrow">{t("friends_eyebrow_privacy")}</span>
          <h2>{t("friends_title_blocked")}</h2>
        </div>
        <span>{blocked.length}</span>
      </div>
      <div class="people-list">
        {#each blocked as user}
          <article class="person-row">
            {@render person(user)}
            <button class="outline-button" onclick={() => act(user.id, "block", "DELETE")}>
              {t("friends_btn_unblock")}
            </button>
          </article>
        {:else}
          <p class="empty-state">{t("friends_empty_blocked")}</p>
        {/each}
      </div>
    </section>
  {/if}
</div>
