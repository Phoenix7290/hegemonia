<script lang="ts">
  import type { FriendSummary } from "@hegemonia/shared";
  import { api, navigate } from "../lib/api";
  import { t } from "../i18n/index.svelte";
  import Avatar from "./Avatar.svelte";

  let { onchanged }: { onchanged: () => void } = $props();
  let query = $state("");
  let users = $state<FriendSummary[]>([]);
  let loading = $state(false);
  let message = $state("");

  async function search(event: SubmitEvent) {
    event.preventDefault();
    if (query.trim().length < 2) return;
    loading = true;
    message = "";
    try {
      const result = await api<{ users: FriendSummary[] }>(
        `/api/users/search?q=${encodeURIComponent(query)}`
      );
      users = result.users;
      if (!users.length) message = t("friends_search_empty");
    } catch (error) {
      message = error instanceof Error ? error.message : t("error_default");
    } finally {
      loading = false;
    }
  }

  async function request(userId: string) {
    try {
      await api<void>(`/api/friends/${userId}/request`, { method: "POST" });
      message = t("friends_request_sent");
      onchanged();
    } catch (error) {
      message = error instanceof Error ? error.message : t("error_action_unavailable");
    }
  }
</script>

<div class="user-search">
  <form onsubmit={search}>
    <input
      bind:value={query}
      minlength="2"
      maxlength="64"
      placeholder={t("friends_search_placeholder")}
      aria-label={t("friends_search_aria")}
    />
    <button class="gold-button" disabled={loading}>
      {loading ? t("friends_btn_searching") : t("friends_btn_search")}
    </button>
  </form>
  {#if message}<p class="form-message">{message}</p>{/if}
  {#if users.length > 0}
    <div class="search-results">
      {#each users as user}
        <article class="person-row">
          <button class="person-link" onclick={() => navigate(`/profile/${user.username}`)}>
            <Avatar name={user.displayName} avatarUrl={user.avatarUrl} size="small" />
            <span>
              <strong>{user.displayName}</strong>
              <small>@{user.username}</small>
            </span>
          </button>
          <button class="outline-button" onclick={() => request(user.id)}>
            {t("friends_btn_add")}
          </button>
        </article>
      {/each}
    </div>
  {/if}
</div>

<style>
  .user-search {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .user-search form {
    display: flex;
    gap: 10px;
  }

  .user-search form input {
    flex: 1;
  }

  .user-search .form-message {
    margin-top: 2px;
  }

  .user-search .search-results {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 2px;
  }
</style>