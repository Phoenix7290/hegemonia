<script lang="ts">
  import App from "./App.svelte";
  import AccountMenu from "./components/AccountMenu.svelte";
  import AuthDialog from "./components/AuthDialog.svelte";
  import FriendsPage from "./components/FriendsPage.svelte";
  import LeaderboardPage from "./components/LeaderboardPage.svelte";
  import ProfilePage from "./components/ProfilePage.svelte";
  import Icon from "./components/Icon.svelte";
  import { auth } from "./lib/auth.svelte";
  import { ui } from "./lib/ui.svelte";
  import { navigate } from "./lib/api";
  import "./social.css";

  let path = $state(window.location.pathname);
  let showTopAudio = $state(false);

  $effect(() => {
    void auth.init();
    const update = () => {
      path = window.location.pathname;
      showTopAudio = false;
    };
    window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  });

  const profileUsername = $derived(
    path.startsWith("/profile/") ? decodeURIComponent(path.slice(9).split("/")[0] ?? "") : null
  );
  const showCommandTopbar = $derived(path !== "/" || !ui.inActiveBattle);
</script>

{#if showCommandTopbar}
  <header class="command-topbar" aria-label="Barra de Estado-Maior">
    <button class="topbar-brand" onclick={() => navigate("/")}>
      <img src="/hegemonia-logo.webp" alt="Hegemonia" class="topbar-logo-img" />
      <div class="topbar-brand-text">
        <strong>HEGEMONIA</strong>
        <small>COMANDO ESTRATÉGICO GLOBAL</small>
      </div>
    </button>

    <nav class="topbar-nav" aria-label="Navegação Principal">
      <button
        class="topbar-link"
        class:active={path === "/"}
        onclick={() => navigate("/")}
      >
        <Icon name="swords" size={16} />
        <span>Operações</span>
      </button>

      <button
        class="topbar-link"
        class:active={path === "/leaderboard"}
        onclick={() => navigate("/leaderboard")}
      >
        <Icon name="rank" size={16} />
        <span>Classificação</span>
      </button>

      <button
        class="topbar-link"
        class:active={path === "/friends"}
        onclick={() => navigate("/friends")}
      >
        <Icon name="users" size={16} />
        <span>Aliados</span>
      </button>

      {#if auth.user}
        <button
          class="topbar-link"
          class:active={profileUsername === auth.user.username}
          onclick={() => navigate(`/profile/${auth.user!.username}`)}
        >
          <Icon name="shield" size={16} />
          <span>Meu Dossiê</span>
        </button>
      {/if}
    </nav>

    <div class="topbar-right">
      <button
        class="topbar-audio-btn"
        class:playing={ui.isMusicPlaying && !ui.isMuted}
        onclick={() => (showTopAudio = !showTopAudio)}
        title="Rádio Militar & Equalizador de Áudio"
      >
        <Icon name={ui.isMuted ? "mute" : "radio"} size={15} />
        <span>{ui.isMuted ? "Mudo" : ui.isMusicPlaying ? "Rádio ON" : "Áudio"}</span>
      </button>

      {#if showTopAudio}
        <div class="topbar-audio-popover">
          <div class="audio-pop-head">
            <strong><Icon name="radio" size={15} /> Central de Áudio Militar</strong>
            <button class="text-button" onclick={() => (showTopAudio = false)} aria-label="Fechar">
              <Icon name="close" size={14} />
            </button>
          </div>

          <div class="audio-eq-actions">
            <button class="gold-button" onclick={() => ui.toggleMusic()}>
              {ui.isMusicPlaying ? "Pausar Trilha" : "Iniciar Trilha"}
            </button>
            <button
              class="outline-button"
              onclick={() => ui.toggleMute()}
              title="Alternar Mute Geral"
            >
              <Icon name={ui.isMuted ? "mute" : "volume"} size={15} />
              {ui.isMuted ? "Ativar Som" : "Mudo"}
            </button>
          </div>

          <div class="audio-eq-row">
            <div class="audio-eq-label">
              <span>Volume da Música</span>
              <span>{Math.round(ui.musicVolume * 100)}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={ui.musicVolume}
              oninput={(e) => ui.setMusicVolume(parseFloat((e.currentTarget as HTMLInputElement).value))}
            />
          </div>

          <div class="audio-eq-row">
            <div class="audio-eq-label">
              <span>Efeitos Sonoros (SFX)</span>
              <span>{Math.round(ui.sfxVolume * 100)}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={ui.sfxVolume}
              oninput={(e) => ui.setSfxVolume(parseFloat((e.currentTarget as HTMLInputElement).value))}
            />
          </div>

          <div class="audio-eq-row">
            <div class="audio-eq-label">
              <span>Frequência / Trilha</span>
            </div>
            <button
              class="outline-button"
              style="justify-content: flex-start; text-align: left;"
              onclick={() => ui.setTrack("ambient_procedural")}
            >
              <Icon name={ui.selectedTrack === "ambient_procedural" ? "check" : "radio"} size={13} />
              Marcha Tática (Procedural)
            </button>
            <button
              class="outline-button"
              style="justify-content: flex-start; text-align: left;"
              onclick={() => ui.setTrack("track1.mp3")}
            >
              <Icon name={ui.selectedTrack === "track1.mp3" ? "check" : "radio"} size={13} />
              Trilha Customizada (track1.mp3)
            </button>
          </div>
        </div>
      {/if}

      <AccountMenu />
    </div>
  </header>
{/if}

<AuthDialog />

{#if path === "/"}
  <App />
{:else}
  <main class="social-shell">
    <div class="social-content">
      {#if profileUsername}
        <ProfilePage username={profileUsername} />
      {:else if path === "/friends"}
        {#if auth.ready && !auth.user}
          <section class="panel sign-in-required">
            <Icon name="users" size={40} />
            <h1>Sua Rede de Aliados</h1>
            <p>Entre ou aliste sua conta de comandante para buscar generais, formar alianças e acompanhar campanhas.</p>
            <button class="gold-button" onclick={() => (auth.dialogOpen = true)}>
              Acessar Credenciais de Comando
            </button>
          </section>
        {:else}
          <FriendsPage />
        {/if}
      {:else if path === "/leaderboard"}
        <LeaderboardPage />
      {:else}
        <section class="panel sign-in-required">
          <h1>Setor Estratégico Não Encontrado</h1>
          <p>As coordenadas solicitadas não constam nos registros cartográficos do Alto Comando.</p>
          <button class="gold-button" onclick={() => navigate("/")}>
            Retornar ao Centro de Operações
          </button>
        </section>
      {/if}
    </div>
  </main>
{/if}
