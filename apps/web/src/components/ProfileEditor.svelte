<script lang="ts">
  import type { AuthUser, ProfileVisibility } from "@hegemonia/shared";
  import { api } from "../lib/api";
  import { auth } from "../lib/auth.svelte";
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
      const result = await api<{ user: AuthUser }>("/api/profile", { method: "PATCH", body: JSON.stringify({ displayName, bio, profileVisibility: visibility }) });
      auth.user = result.user;
      message = "Perfil atualizado.";
      onsaved();
    } catch (error) { message = error instanceof Error ? error.message : "Falha ao salvar."; }
    finally { saving = false; }
  }

  async function upload(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    uploading = true;
    message = "";
    try {
      const result = await api<{ avatarUrl: string }>("/api/profile/avatar", { method: "PUT", body: file });
      avatarUrl = result.avatarUrl;
      if (auth.user) auth.user.avatarUrl = avatarUrl;
      message = "Foto de perfil atualizada.";
      onsaved();
    } catch (error) { message = error instanceof Error ? error.message : "Falha ao enviar imagem."; }
    finally { uploading = false; input.value = ""; }
  }

  async function removeAvatar() {
    await api<void>("/api/profile/avatar", { method: "DELETE" });
    avatarUrl = null;
    if (auth.user) auth.user.avatarUrl = null;
    onsaved();
  }
</script>

<form class="profile-editor" onsubmit={save}>
  <div class="editor-heading"><div><span class="eyebrow">REGISTRO PESSOAL</span><h2>Editar perfil</h2></div></div>
  <div class="avatar-editor">
    <Avatar name={displayName} {avatarUrl} size="large"/>
    <div><strong>Foto de perfil</strong><p>JPEG, PNG, WebP, GIF ou AVIF. Convertida para WebP de 256 px.</p>
      <label class="file-button">{uploading ? "Processando..." : "Escolher imagem"}<input type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif" onchange={upload} disabled={uploading}/></label>
      {#if avatarUrl}<button type="button" class="text-button" onclick={removeAvatar}>Remover foto</button>{/if}
    </div>
  </div>
  <label>Nome de exibição<input bind:value={displayName} required maxlength="32"/></label>
  <label>Biografia<textarea bind:value={bio} maxlength="500" rows="4" placeholder="Sua doutrina, histórico ou preferências de jogo."></textarea><small>{bio.length}/500</small></label>
  <label>Privacidade das estatísticas
    <select bind:value={visibility}>
      <option value="public">Público — qualquer pessoa pode ver</option>
      <option value="friends">Amigos — somente amigos aceitos</option>
      <option value="private">Privado — somente você</option>
    </select>
  </label>
  <p class="privacy-note">Seu nome, usuário e foto continuam visíveis. Bloqueios prevalecem sobre qualquer configuração.</p>
  {#if message}<p class="form-message" role="status">{message}</p>{/if}
  <button class="gold-button" disabled={saving}>{saving ? "Salvando..." : "Salvar alterações"}</button>
</form>
