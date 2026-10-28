<script lang="ts">
  import App from "./App.svelte";
  import AccountMenu from "./components/AccountMenu.svelte";
  import AuthDialog from "./components/AuthDialog.svelte";
  import FriendsPage from "./components/FriendsPage.svelte";
  import LeaderboardPage from "./components/LeaderboardPage.svelte";
  import ProfilePage from "./components/ProfilePage.svelte";
  import Icon from "./components/Icon.svelte";
  import { auth } from "./lib/auth.svelte";
  import { navigate } from "./lib/api";
  import "./social.css";

  let path = $state(window.location.pathname);
  $effect(() => {
    void auth.init();
    const update = () => path = window.location.pathname;
    window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  });
  const profileUsername = $derived(path.startsWith("/profile/") ? decodeURIComponent(path.slice(9).split("/")[0] ?? "") : null);
</script>

<div class="account-dock"><AccountMenu/></div>
<AuthDialog/>

{#if path === "/"}
  <App/>
{:else}
  <main class="social-shell">
    <nav class="social-nav" aria-label="Navegação da conta">
      <button class="social-brand" onclick={() => navigate("/")}><Icon name="shield" size={24}/><span>HEGEMONIA<small>COMANDO SOCIAL</small></span></button>
      <div class="social-links"><button class:active={path === "/friends"} onclick={() => navigate("/friends")}><Icon name="users"/> Amigos</button><button class:active={path === "/leaderboard"} onclick={() => navigate("/leaderboard")}><Icon name="rank"/> Classificação</button><button onclick={() => navigate("/")}><Icon name="back"/> Voltar ao jogo</button></div>
    </nav>
    <div class="social-content">
      {#if profileUsername}<ProfilePage username={profileUsername}/>
      {:else if path === "/friends"}
        {#if auth.ready && !auth.user}<section class="panel sign-in-required"><Icon name="users" size={36}/><h1>Sua rede de aliados</h1><p>Entre ou crie uma conta para encontrar amigos e acompanhar suas campanhas.</p><button class="gold-button" onclick={() => auth.dialogOpen = true}>Acessar minha conta</button></section>{:else}<FriendsPage/>{/if}
      {:else if path === "/leaderboard"}<LeaderboardPage/>
      {:else}<section class="panel sign-in-required"><h1>Setor não encontrado</h1><button onclick={() => navigate("/")}>Retornar ao comando</button></section>{/if}
    </div>
  </main>
{/if}
