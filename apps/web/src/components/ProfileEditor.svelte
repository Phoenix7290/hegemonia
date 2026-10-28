<script lang="ts">
  import type { AuthUser, ProfileVisibility } from "@hegemonia/shared";
  import { api } from "../lib/api";
  import { auth } from "../lib/auth.svelte";
  import { t } from "../i18n/index.svelte";
  import Avatar from "./Avatar.svelte";

  let { onsaved }: { onsaved: () => void } = $props();
  let displayName = $state(auth.user?.displayName ?? "");
  let bio = $state(auth.user?.bio ?? "");
  let visibility = $state<ProfileVisibility>(auth.user?.profileVisibility ?? "public");
  let avatarUrl = $state(auth.user?.avatarUrl ?? null);
  let saving = $state(false);
  let uploading = $state(false);
  let message = $state("");

  async function save(event: SubmitEvent) {
    event.preventDefault();
    saving = true;
    message = "";
    try {
      const result = await api<{ user: AuthUser }>("/api/profile", {
        method: "PATCH",
        body: JSON.stringify({ displayName, bio, profileVisibility: visibility }),
      });
      auth.user = result.user;
      message = t("editor_saved_success");
      onsaved();
    } catch (error) {
      message = error instanceof Error ? error.message : t("error_default");
    } finally {
      saving = false;
    }
  }

  async function upload(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    uploading = true;
    message = "";
    try {
      const result = await api<{ avatarUrl: string }>("/api/profile/avatar", {
        method: "PUT",
        body: file,
      });
      avatarUrl = result.avatarUrl;
      if (auth.user) auth.user.avatarUrl = avatarUrl;
      message = t("editor_saved_success");
      onsaved();
    } catch (error) {
      message = error instanceof Error ? error.message : t("error_invalid_image");
    } finally {
      uploading = false;
      input.value = "";
    }
  }

  async function removeAvatar() {
    await api<void>("/api/profile/avatar", { method: "DELETE" });
    avatarUrl = null;
    if (auth.user) auth.user.avatarUrl = null;
    onsaved();
  }
</script>

<form class="profile-editor" onsubmit={save}>
  <div class="editor-heading">
    <div>
      <span class="eyebrow">{t("editor_eyebrow")}</span>
      <h2>{t("editor_title")}</h2>
    </div>
  </div>
  <div class="avatar-editor">
    <Avatar name={displayName} {avatarUrl} size="large" />
    <div>
      <strong>{t("editor_display_name_label")}</strong>
      <p>JPEG, PNG, WebP, GIF ou AVIF. (Max 5 MiB)</p>
      <label class="file-button">
        {uploading ? t("editor_btn_uploading") : t("editor_btn_upload")}
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
          onchange={upload}
          disabled={uploading}
        />
      </label>
      {#if avatarUrl}
        <button type="button" class="text-button" onclick={removeAvatar}>
          {t("editor_btn_remove_avatar")}
        </button>
      {/if}
    </div>
  </div>
  <label>
    {t("editor_display_name_label")}
    <input bind:value={displayName} required maxlength="32" />
  </label>
  <label>
    {t("editor_bio_label")}
    <textarea
      bind:value={bio}
      maxlength="500"
      rows="4"
      placeholder={t("editor_bio_placeholder")}
    ></textarea>
    <small>{bio.length}/500</small>
  </label>
  <label>
    {t("editor_privacy_label")}
    <select bind:value={visibility}>
      <option value="public">{t("editor_privacy_public")}</option>
      <option value="friends">{t("editor_privacy_friends")}</option>
      <option value="private">{t("editor_privacy_private")}</option>
    </select>
  </label>
  <p class="privacy-note">{t("editor_privacy_note")}</p>
  {#if message}<p class="form-message" role="status">{message}</p>{/if}
  <button class="gold-button" disabled={saving}>
    {saving ? t("editor_btn_saving") : t("editor_btn_save")}
  </button>
</form>
