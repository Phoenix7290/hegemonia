<script lang="ts">
  import { auth } from "../lib/auth.svelte";
  import { navigate } from "../lib/api";
  import { t } from "../i18n/index.svelte";
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
      <button class="account-trigger" aria-expanded={open} onclick={() => (open = !open)}>
        <Avatar name={auth.user.displayName} avatarUrl={auth.user.avatarUrl} size="small" />
        <span>
          <strong>{auth.user.displayName}</strong>
          <small>@{auth.user.username}</small>
        </span>
        <Icon name="chevrons" size={13} />
      </button>
      {#if open}
        <div class="account-dropdown">
          <button onclick={() => go(`/profile/${auth.user!.username}`)}>
            <Icon name="user" size={16} /> {t("menu_dossier")}
          </button>
          <button onclick={() => go("/friends")}>
            <Icon name="users" size={16} /> {t("menu_allies")}
          </button>
          <button onclick={() => go("/leaderboard")}>
            <Icon name="rank" size={16} /> {t("menu_leaderboard")}
          </button>
          <button onclick={() => go(`/profile/${auth.user!.username}?edit=1`)}>
            <Icon name="settings" size={16} /> {t("menu_edit_profile")}
          </button>
          <hr />
          <button onclick={logout}>
            <Icon name="logout" size={16} /> {t("menu_logout")}
          </button>
        </div>
      {/if}
    </div>
  {:else}
    <button class="login-button" onclick={() => (auth.dialogOpen = true)}>
      <Icon name="shield" size={15} /> {t("menu_login_register")}
    </button>
  {/if}
{/if}
