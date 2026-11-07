<script lang="ts">
  import { versionGuard } from "../lib/version.svelte";
  import { ui } from "../lib/ui.svelte";
  import { t } from "../i18n/index.svelte";
  import Icon from "./Icon.svelte";

  const showBanner = $derived(
    versionGuard.isOutdated && !versionGuard.dismissed && versionGuard.serverVersion !== null
  );
</script>

{#if showBanner}
  <aside
    class="version-update-banner"
    role="alert"
    aria-live="assertive"
  >
    <div class="banner-icon-container">
      <Icon name="alert" size={22} color="#FBBF24" />
    </div>

    <div class="banner-body">
      <div class="banner-title">
        <strong>{t("version_update_available_title")}</strong>
        <span class="version-badge">v{versionGuard.serverVersion}</span>
      </div>
      <p class="banner-desc">
        {#if versionGuard.countdown !== null}
          {t("version_update_lobby_autoreload", {
            serverVersion: versionGuard.serverVersion,
            seconds: versionGuard.countdown,
          })}
        {:else if ui.inActiveBattle}
          {t("version_update_in_battle_desc", {
            serverVersion: versionGuard.serverVersion,
          })}
        {:else}
          {t("version_update_available_desc", {
            serverVersion: versionGuard.serverVersion,
          })}
        {/if}
      </p>
    </div>

    <div class="banner-actions">
      <button
        class="gold-button btn-reload"
        onclick={() => versionGuard.reload()}
      >
        <Icon name="reset" size={15} />
        <span>{t("version_update_reload_now")}</span>
      </button>

      {#if versionGuard.countdown !== null}
        <button
          class="outline-button btn-cancel"
          onclick={() => versionGuard.cancelCountdown()}
        >
          {t("cancel")}
        </button>
      {:else}
        <button
          class="outline-button btn-dismiss"
          onclick={() => versionGuard.dismiss()}
        >
          {t("version_update_dismiss")}
        </button>
      {/if}
    </div>
  </aside>
{/if}

<style>
  .version-update-banner {
    position: fixed;
    top: 1rem;
    left: 50%;
    transform: translateX(-50%);
    width: min(680px, calc(100vw - 2rem));
    z-index: 99999;
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 0.85rem 1.25rem;
    background: rgba(15, 23, 42, 0.96);
    border: 1px solid #f59e0b;
    border-radius: 8px;
    box-shadow:
      0 10px 25px -5px rgba(0, 0, 0, 0.75),
      0 0 20px rgba(245, 158, 11, 0.25);
    backdrop-filter: blur(10px);
    animation: slideDown 0.25s ease-out;
  }

  @keyframes slideDown {
    from {
      opacity: 0;
      transform: translate(-50%, -15px);
    }
    to {
      opacity: 1;
      transform: translate(-50%, 0);
    }
  }

  .banner-icon-container {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 38px;
    height: 38px;
    background: rgba(245, 158, 11, 0.12);
    border: 1px solid rgba(245, 158, 11, 0.35);
    border-radius: 6px;
  }

  .banner-body {
    flex: 1;
    min-width: 0;
  }

  .banner-title {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    color: #fef08a;
    font-size: 0.9rem;
    letter-spacing: 0.02em;
  }

  .version-badge {
    padding: 0.1rem 0.4rem;
    font-size: 0.75rem;
    font-weight: 700;
    font-family: monospace;
    background: rgba(245, 158, 11, 0.25);
    color: #fef08a;
    border-radius: 4px;
    border: 1px solid rgba(245, 158, 11, 0.4);
  }

  .banner-desc {
    margin: 0.25rem 0 0;
    color: #cbd5e1;
    font-size: 0.78rem;
    line-height: 1.35;
  }

  .banner-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-shrink: 0;
  }

  .btn-reload {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.45rem 0.85rem;
    font-size: 0.78rem;
    font-weight: 700;
    white-space: nowrap;
    background: #d97706;
    color: #000;
    border: 1px solid #f59e0b;
    border-radius: 5px;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .btn-reload:hover {
    background: #f59e0b;
  }

  .btn-cancel,
  .btn-dismiss {
    padding: 0.45rem 0.7rem;
    font-size: 0.75rem;
    color: #94a3b8;
    background: transparent;
    border: 1px solid rgba(148, 163, 184, 0.3);
    border-radius: 5px;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .btn-cancel:hover,
  .btn-dismiss:hover {
    color: #f1f5f9;
    border-color: rgba(148, 163, 184, 0.6);
  }

  @media (max-width: 640px) {
    .version-update-banner {
      flex-direction: column;
      align-items: stretch;
      gap: 0.75rem;
      top: 0.5rem;
    }

    .banner-actions {
      justify-content: flex-end;
    }
  }
</style>
