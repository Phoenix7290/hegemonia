<script lang="ts">
  import App from "./App.svelte";
  import AccountMenu from "./components/AccountMenu.svelte";
  import AuthDialog from "./components/AuthDialog.svelte";
  import FriendsPage from "./components/FriendsPage.svelte";
  import LeaderboardPage from "./components/LeaderboardPage.svelte";
  import ProfilePage from "./components/ProfilePage.svelte";
  import Icon from "./components/Icon.svelte";
  import LanguageSelector from "./components/LanguageSelector.svelte";
  import { auth } from "./lib/auth.svelte";
  import { ui } from "./lib/ui.svelte";
  import { navigate } from "./lib/api";
  import { t } from "./i18n/index.svelte";
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
  <header class="command-topbar" aria-label={t("brand_subtitle")}>
    <button class="topbar-brand" onclick={() => navigate("/")}>
      <img src="/hegemonia-logo.webp" alt={t("brand_title")} class="topbar-logo-img" />
      <div class="topbar-brand-text">
        <strong>{t("brand_title")}</strong>
        <small>{t("brand_subtitle")}</small>
      </div>
    </button>

    <nav class="topbar-nav" aria-label={t("nav_operations")}>
      <button
        class="topbar-link"
        class:active={path === "/"}
        onclick={() => navigate("/")}
      >
        <Icon name="swords" size={16} />
        <span>{t("nav_operations")}</span>
      </button>

      <button
        class="topbar-link"
        class:active={path === "/leaderboard"}
        onclick={() => navigate("/leaderboard")}
      >
        <Icon name="rank" size={16} />
        <span>{t("nav_leaderboard")}</span>
      </button>

      <button
        class="topbar-link"
        class:active={path === "/friends"}
        onclick={() => navigate("/friends")}
      >
        <Icon name="users" size={16} />
        <span>{t("nav_allies")}</span>
      </button>

      {#if auth.user}
        <button
          class="topbar-link"
          class:active={profileUsername === auth.user.username}
          onclick={() => navigate(`/profile/${auth.user!.username}`)}
        >
          <Icon name="shield" size={16} />
          <span>{t("nav_dossier")}</span>
        </button>
      {/if}
    </nav>

    <div class="topbar-right">
      <LanguageSelector />

      <button
        class="topbar-audio-btn"
        class:playing={ui.isMusicPlaying && !ui.isMuted}
        onclick={() => (showTopAudio = !showTopAudio)}
        title={t("audio_radio_eq")}
      >
        <Icon name={ui.isMuted ? "mute" : "radio"} size={15} />
        <span>{ui.isMuted ? t("audio_muted") : ui.isMusicPlaying ? t("audio_radio_on") : t("audio_status")}</span>
      </button>

      {#if showTopAudio}
        <div class="topbar-audio-popover">
          <div class="audio-pop-head">
            <strong><Icon name="radio" size={15} /> {t("audio_panel_title")}</strong>
            <button class="text-button" onclick={() => (showTopAudio = false)} aria-label={t("close")}>
              <Icon name="close" size={14} />
            </button>
          </div>

          <div class="audio-eq-actions">
            <button class="gold-button" onclick={() => ui.toggleMusic()}>
              {ui.isMusicPlaying ? t("audio_pause_track") : t("audio_start_track")}
            </button>
            <button
              class="outline-button"
              onclick={() => ui.toggleMute()}
              title={t("audio_mute_all")}
            >
              <Icon name={ui.isMuted ? "mute" : "volume"} size={15} />
              {ui.isMuted ? t("audio_unmute") : t("audio_mute")}
            </button>
          </div>

          <div class="audio-eq-row">
            <div class="audio-eq-label">
              <span>{t("audio_music_vol")}</span>
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
              <span>{t("audio_sfx_vol")}</span>
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
              <span>{t("audio_track_label")}</span>
            </div>
            <button
              class="outline-button"
              style="justify-content: flex-start; text-align: left;"
              onclick={() => ui.setTrack("ambient_procedural")}
            >
              <Icon name={ui.selectedTrack === "ambient_procedural" ? "check" : "radio"} size={13} />
              {t("audio_track_procedural")}
            </button>
            <button
              class="outline-button"
              style="justify-content: flex-start; text-align: left;"
              onclick={() => ui.setTrack("track1.mp3")}
            >
              <Icon name={ui.selectedTrack === "track1.mp3" ? "check" : "radio"} size={13} />
              {t("audio_track_custom")}
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
            <h1>{t("friends_login_required_title")}</h1>
            <p>{t("friends_login_required_desc")}</p>
            <button class="gold-button" onclick={() => (auth.dialogOpen = true)}>
              {t("friends_btn_access_credentials")}
            </button>
          </section>
        {:else}
          <FriendsPage />
        {/if}
      {:else if path === "/leaderboard"}
        <LeaderboardPage />
      {:else}
        <section class="panel sign-in-required">
          <h1>{t("not_found_title")}</h1>
          <p>{t("not_found_desc")}</p>
          <button class="gold-button" onclick={() => navigate("/")}>
            {t("not_found_btn")}
          </button>
        </section>
      {/if}
    </div>
  </main>
{/if}
