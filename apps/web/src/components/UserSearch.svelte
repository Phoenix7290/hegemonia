<script lang="ts">
  import type { FriendSummary } from "@hegemonia/shared";
  import { api, navigate } from "../lib/api";
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
      const result = await api<{ users: FriendSummary[] }>(`/api/users/search?q=${encodeURIComponent(query)}`);
      users = result.users;
      if (!users.length) message = "Nenhum comandante encontrado.";
    } catch (error) { message = error instanceof Error ? error.message : "Busca indisponível."; }
    finally { loading = false; }
  }
  async function request(userId: string) {
    try { await api<void>(`/api/friends/${userId}/request`, { method: "POST" }); message = "Solicitação registrada."; onchanged(); }
    catch (error) { message = error instanceof Error ? error.message : "Não foi possível adicionar."; }
  }
</script>

<div class="user-search">
  <form onsubmit={search}><input bind:value={query} minlength="2" maxlength="64" placeholder="Buscar por usuário ou nome de exibição" aria-label="Buscar comandantes"/><button class="gold-button" disabled={loading}>{loading ? "Buscando..." : "Buscar"}</button></form>
  {#if message}<p class="form-message">{message}</p>{/if}
  <div class="search-results">
    {#each users as user}
      <article class="person-row"><button class="person-link" onclick={() => navigate(`/profile/${user.username}`)}><Avatar name={user.displayName} avatarUrl={user.avatarUrl} size="small"/><span><strong>{user.displayName}</strong><small>@{user.username}</small></span></button><button class="outline-button" onclick={() => request(user.id)}>Adicionar</button></article>
    {/each}
  </div>
</div>
