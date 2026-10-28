<script lang="ts">
  import { auth } from "../lib/auth.svelte";
  import { api } from "../lib/api";
  import { t } from "../i18n/index.svelte";
  import type { AuthUser } from "@hegemonia/shared";
  import Icon from "./Icon.svelte";

  let mode = $state<"login" | "register">("login");
  let identifier = $state("");
  let email = $state("");
  let username = $state("");
  let displayName = $state("");
  let password = $state("");
  let error = $state("");
  let loading = $state(false);

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    error = "";
    loading = true;
    try {
      const result =
        mode === "login"
          ? await api<{ user: AuthUser }>("/api/auth/login", {
              method: "POST",
              body: JSON.stringify({ identifier, password }),
            })
          : await api<{ user: AuthUser }>("/api/auth/register", {
              method: "POST",
              body: JSON.stringify({ email, username, displayName, password }),
            });
      auth.user = result.user;
      auth.dialogOpen = false;
      password = "";
    } catch (cause) {
      error = cause instanceof Error ? cause.message : t("error_auth_failed");
    } finally {
      loading = false;
    }
  }
</script>

{#if auth.dialogOpen}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    class="auth-backdrop"
    role="presentation"
    onclick={(e) => {
      if (e.target === e.currentTarget) auth.dialogOpen = false;
    }}
  >
    <dialog open class="auth-dialog" aria-labelledby="auth-title">
      <button class="dialog-close" aria-label={t("close")} onclick={() => (auth.dialogOpen = false)}>
        <Icon name="close" size={16} />
      </button>

      <div class="auth-logo-banner">
        <img src="/hegemonia-logo.webp" alt="Hegemonia Emblem" />
      </div>

      <span class="eyebrow">{t("auth_eyebrow")}</span>
      <h2 id="auth-title">
        {mode === "login" ? t("auth_login_title") : t("auth_register_title")}
      </h2>
      <p class="auth-intro">
        {t("auth_intro")}
      </p>

      <div class="auth-tabs" role="tablist">
        <button
          type="button"
          class:active={mode === "login"}
          onclick={() => {
            mode = "login";
            error = "";
          }}
        >
          {t("auth_tab_login")}
        </button>
        <button
          type="button"
          class:active={mode === "register"}
          onclick={() => {
            mode = "register";
            error = "";
          }}
        >
          {t("auth_tab_register")}
        </button>
      </div>

      <form onsubmit={submit}>
        {#if mode === "register"}
          <label>
            {t("auth_email_label")}
            <input
              type="email"
              bind:value={email}
              autocomplete="email"
              required
              maxlength="254"
              placeholder={t("auth_email_placeholder")}
            />
          </label>
          <div class="form-row">
            <label>
              {t("auth_username_label")}
              <input
                bind:value={username}
                autocomplete="username"
                required
                minlength="3"
                maxlength="24"
                pattern="[A-Za-z0-9_]+"
                placeholder={t("auth_username_placeholder")}
              />
            </label>
            <label>
              {t("auth_display_name_label")}
              <input
                bind:value={displayName}
                required
                maxlength="32"
                placeholder={t("auth_display_name_placeholder")}
              />
            </label>
          </div>
        {:else}
          <label>
            {t("auth_identifier_label")}
            <input
              bind:value={identifier}
              autocomplete="username"
              required
              placeholder={t("auth_identifier_placeholder")}
            />
          </label>
        {/if}

        <label>
          {t("auth_password_label")}
          <input
            type="password"
            bind:value={password}
            autocomplete={mode === "login" ? "current-password" : "new-password"}
            required
            minlength={mode === "register" ? 12 : 1}
            maxlength="128"
            placeholder={mode === "register"
              ? t("auth_password_register_ph")
              : t("auth_password_login_ph")}
          />
        </label>

        {#if error}
          <p class="form-error" role="alert">{error}</p>
        {/if}

        <button class="gold-button full" disabled={loading}>
          {loading
            ? t("auth_btn_verifying")
            : mode === "login"
              ? t("auth_btn_login")
              : t("auth_btn_register")}
        </button>
      </form>

      <p class="security-note">
        {t("auth_security_note")}
      </p>
    </dialog>
  </div>
{/if}
