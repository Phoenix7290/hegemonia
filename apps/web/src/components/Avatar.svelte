<script lang="ts">
  import { assetUrl } from "../lib/api";
  let { name, avatarUrl = null, size = "medium" }: { name: string; avatarUrl?: string | null; size?: "small" | "medium" | "large" } = $props();
  const initials = $derived(name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "G");
</script>

<div class="avatar avatar-{size}" aria-label={`Foto de perfil de ${name}`}>
  {#if assetUrl(avatarUrl)}
    <img src={assetUrl(avatarUrl)!} alt="" />
  {:else}
    <span>{initials}</span>
  {/if}
</div>

<style>
  .avatar { display: grid; place-items: center; flex: 0 0 auto; overflow: hidden; border: 1px solid #596477; border-radius: 4px; background: linear-gradient(145deg, #293548, #111a28); color: #e7c877; font-family: Georgia, serif; font-weight: 700; box-shadow: inset 0 0 0 2px #0b111c; }
  .avatar-small { width: 34px; height: 34px; font-size: .72rem; }
  .avatar-medium { width: 48px; height: 48px; font-size: .9rem; }
  .avatar-large { width: 112px; height: 112px; font-size: 2rem; border-color: #a78b45; }
  img { width: 100%; height: 100%; object-fit: cover; }
</style>
