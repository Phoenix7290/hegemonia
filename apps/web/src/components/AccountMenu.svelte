<script lang="ts">
  import { auth } from "../lib/auth.svelte";
  import { navigate } from "../lib/api";
  import Avatar from "./Avatar.svelte";
  import Icon from "./Icon.svelte";
  let open = $state(false);

  function go(path: string) {
    open = false;
    navigate(path);
  }
  async function logout() {
    open = false;
    await auth.logout();
    if (window.location.pathname !== "/") navigate("/");
  }
</script>

{#if auth.ready}
  {#if auth.user}
    <div class="account-menu">
      <button class="account-trigger" aria-expanded={open} onclick={() => open = !open}>
        <Avatar name={auth.user.displayName} avatarUrl={auth.user.avatarUrl} size="small"/>
        <span><strong>{auth.user.displayName}</strong><small>@{auth.user.username}</small></span>
      </button>
      {#if open}
        <div class="account-dropdown">
          <button onclick={() => go(`/profile/${auth.user!.username}`)}><Icon name="user"/> Meu perfil</button>
          <button onclick={() => go("/friends")}><Icon name="users"/> Amigos</button>
          <button onclick={() => go("/leaderboard")}><Icon name="rank"/> Classificação</button>
          <button onclick={() => go(`/profile/${auth.user!.username}?edit=1`)}><Icon name="settings"/> Editar perfil</button>
          <hr/>
          <button onclick={logout}><Icon name="logout"/> Encerrar sessão</button>
        </div>
      {/if}
    </div>
  {:else}
    <button class="login-button" onclick={() => auth.dialogOpen = true}><Icon name="user"/> Entrar ou criar conta</button>
  {/if}
{/if}
