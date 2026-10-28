<script lang="ts">
  import type { FriendSummary } from "@hegemonia/shared";
  import { api, navigate } from "../lib/api";
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
      friends = f.friends; incoming = r.incoming; outgoing = r.outgoing; blocked = b.blocked;
    } catch (cause) { error = cause instanceof Error ? cause.message : "Rede social indisponível."; }
    finally { loading = false; }
  }
  $effect(() => { void load(); });
  async function act(id: string, action = "", method = "POST") {
    try { await api<void>(`/api/friends/${id}${action ? `/${action}` : ""}`, { method }); await load(); }
    catch (cause) { error = cause instanceof Error ? cause.message : "Ação indisponível."; }
  }
</script>

{#snippet person(user: FriendSummary)}
  <button class="person-link" onclick={() => navigate(`/profile/${user.username}`)}><Avatar name={user.displayName} avatarUrl={user.avatarUrl}/><span><strong>{user.displayName}</strong><small>@{user.username}</small></span></button>
{/snippet}

<div class="friends-layout">
  <section class="panel"><div class="section-heading"><div><span class="eyebrow">NOVOS CONTATOS</span><h1>Encontrar comandantes</h1></div></div><UserSearch onchanged={() => void load()}/></section>
  {#if error}<p class="form-error">{error}</p>{/if}
  {#if loading}<div class="loading-panel">Carregando rede de aliados...</div>{:else}
    <section class="panel"><div class="section-heading"><div><span class="eyebrow">SOLICITAÇÕES</span><h2>Aguardando resposta</h2></div><span>{incoming.length}</span></div>
      <div class="people-list">{#each incoming as user}<article class="person-row">{@render person(user)}<div class="row-actions"><button class="gold-button" onclick={() => act(user.id, "accept")}>Aceitar</button><button class="outline-button" onclick={() => act(user.id, "decline")}>Recusar</button></div></article>{:else}<p class="empty-state">Nenhuma solicitação recebida.</p>{/each}</div>
      {#if outgoing.length}<h3 class="subsection-title">Enviadas por você</h3><div class="people-list">{#each outgoing as user}<article class="person-row">{@render person(user)}<button class="text-button" onclick={() => act(user.id, "", "DELETE")}>Cancelar solicitação</button></article>{/each}</div>{/if}
    </section>
    <section class="panel"><div class="section-heading"><div><span class="eyebrow">ALIADOS CONFIRMADOS</span><h2>Meus amigos</h2></div><span>{friends.length}</span></div>
      <div class="people-list">{#each friends as user}<article class="person-row">{@render person(user)}<div class="row-actions"><button class="outline-button" onclick={() => navigate(`/profile/${user.username}`)}>Ver perfil</button><button class="text-button" onclick={() => act(user.id, "", "DELETE")}>Remover</button></div></article>{:else}<p class="empty-state">Sua rede ainda está vazia. Busque comandantes para formar alianças.</p>{/each}</div>
    </section>
    <section class="panel"><div class="section-heading"><div><span class="eyebrow">PRIVACIDADE</span><h2>Jogadores bloqueados</h2></div><span>{blocked.length}</span></div>
      <div class="people-list">{#each blocked as user}<article class="person-row">{@render person(user)}<button class="outline-button" onclick={() => act(user.id, "block", "DELETE")}>Desbloquear</button></article>{:else}<p class="empty-state">Nenhum jogador bloqueado.</p>{/each}</div>
    </section>
  {/if}
</div>
