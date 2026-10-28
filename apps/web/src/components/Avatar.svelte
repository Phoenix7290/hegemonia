<script lang="ts">
  import { assetUrl } from "../lib/api";
  let {
    name,
    avatarUrl = null,
    size = "medium",
  }: { name: string; avatarUrl?: string | null; size?: "small" | "medium" | "large" } = $props();
  const initials = $derived(
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase() || "G"
  );
</script>

<div class="avatar avatar-{size}" aria-label={`Foto de perfil de ${name}`}>
  {#if assetUrl(avatarUrl)}
    <img src={assetUrl(avatarUrl)!} alt="" />
  {:else}
    <span>{initials}</span>
  {/if}
</div>

<style>
  .avatar {
    display: grid;
    place-items: center;
    flex: 0 0 auto;
    overflow: hidden;
    border: 1px solid rgba(212, 175, 55, 0.52);
    border-radius: 4px;
    background: linear-gradient(145deg, #1d2d4b, #0c1424);
    color: #fef08a;
    font-family: var(--font-display);
    font-weight: 800;
    box-shadow: inset 0 0 0 2px #070c16, 0 2px 6px rgba(0, 0, 0, 0.6);
  }
  .avatar-small {
    width: 34px;
    height: 34px;
    font-size: 0.72rem;
  }
  .avatar-medium {
    width: 48px;
    height: 48px;
    font-size: 0.92rem;
  }
  .avatar-large {
    width: 112px;
    height: 112px;
    font-size: 2rem;
    border-color: #eab308;
    box-shadow: inset 0 0 0 3px #070c16, 0 8px 24px rgba(0, 0, 0, 0.75);
  }
  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
</style>
