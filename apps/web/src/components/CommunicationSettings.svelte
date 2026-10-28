<script lang="ts">
  import type { CommunicationsController } from "../lib/communications.svelte";
  import { t } from "../i18n/index.svelte";
  import Icon from "./Icon.svelte";

  let {
    controller,
    onClose,
  }: {
    controller: CommunicationsController;
    onClose: () => void;
  } = $props();

  let capturingKey = $state(false);

  $effect(() => {
    void controller.refreshMicrophones();
  });

  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return {
      destroy() {
        node.remove();
      },
    };
  }

  function keyLabel(code: string): string {
    if (code.startsWith("Key")) return code.slice(3);
    if (code.startsWith("Digit")) return code.slice(5);
    return code.replace("Arrow", t("key_arrow") + " ").replace("Space", t("key_space"));
  }

  function captureKey(event: KeyboardEvent): void {
    if (!capturingKey) {
      if (event.key === "Escape") {
        onClose();
      }
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (event.code === "Escape") {
      capturingKey = false;
      return;
    }
    controller.updateSettings({ pushToTalkKey: event.code });
    capturingKey = false;
  }

  function handleBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      onClose();
    }
  }
</script>

<svelte:window onkeydown={captureKey} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<div class="settings-layer" use:portal role="presentation" onclick={handleBackdropClick}>
  <div class="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="comms-settings-title">
    <header class="settings-header">
      <div>
        <span class="eyebrow">{t("comms_settings_eyebrow")}</span>
        <h3 id="comms-settings-title"><Icon name="settings" size={17} /> {t("comms_settings_title")}</h3>
      </div>
      <button class="icon-button" onclick={onClose} aria-label={t("comms_close_settings")}>
        <Icon name="close" size={17} />
      </button>
    </header>

    <div class="settings-content">
      <section class="settings-section">
        <h4>{t("comms_sec_interface")}</h4>

        <div class="field-block size-field-block">
          <div class="size-field-header">
            <span class="field-label">{t("comms_chat_size_label")}</span>
            <small>{t("comms_chat_size_desc")}</small>
          </div>
          <div class="segmented-control">
            <button
              type="button"
              class:active={controller.settings.chatSize === "normal"}
              onclick={() => controller.updateSettings({ chatSize: "normal" })}
            >
              {t("comms_size_normal")}
            </button>
            <button
              type="button"
              class:active={controller.settings.chatSize === "large"}
              onclick={() => controller.updateSettings({ chatSize: "large" })}
            >
              {t("comms_size_large")}
            </button>
            <button
              type="button"
              class:active={controller.settings.chatSize === "expanded"}
              onclick={() => controller.updateSettings({ chatSize: "expanded" })}
            >
              {t("comms_size_expanded")}
            </button>
          </div>
        </div>

        <label class="toggle-row">
          <span><strong>{t("comms_opt_avatars_label")}</strong><small>{t("comms_opt_avatars_desc")}</small></span>
          <input
            type="checkbox"
            checked={controller.settings.showAvatars}
            onchange={(event) => controller.updateSettings({ showAvatars: event.currentTarget.checked })}
          />
        </label>
        <label class="toggle-row">
          <span><strong>{t("comms_opt_timestamps_label")}</strong><small>{t("comms_opt_timestamps_desc")}</small></span>
          <input
            type="checkbox"
            checked={controller.settings.showTimestamps}
            onchange={(event) => controller.updateSettings({ showTimestamps: event.currentTarget.checked })}
          />
        </label>
        <label class="toggle-row">
          <span><strong>{t("comms_opt_enter_send_label")}</strong><small>{t("comms_opt_enter_send_desc")}</small></span>
          <input
            type="checkbox"
            checked={controller.settings.enterToSend}
            onchange={(event) => controller.updateSettings({ enterToSend: event.currentTarget.checked })}
          />
        </label>
        <label class="toggle-row">
          <span><strong>{t("comms_opt_intel_label")}</strong><small>{t("comms_opt_intel_desc")}</small></span>
          <input
            type="checkbox"
            checked={controller.settings.showIntel}
            onchange={(event) => controller.updateSettings({ showIntel: event.currentTarget.checked })}
          />
        </label>
        <label class="toggle-row">
          <span><strong>{t("comms_opt_sound_label")}</strong><small>{t("comms_opt_sound_desc")}</small></span>
          <input
            type="checkbox"
            checked={controller.settings.notificationSound}
            onchange={(event) => controller.updateSettings({ notificationSound: event.currentTarget.checked })}
          />
        </label>
      </section>

      <section class="settings-section">
        <h4>{t("comms_sec_radio")}</h4>
        <div class="field-block">
          <span class="field-label">{t("comms_tx_mode_label")}</span>
          <div class="segmented-control">
            <button
              type="button"
              class:active={controller.settings.pushToTalk}
              onclick={() => controller.updateSettings({ pushToTalk: true })}
            >
              {t("comms_tx_mode_ptt")}
            </button>
            <button
              type="button"
              class:active={!controller.settings.pushToTalk}
              onclick={() => controller.updateSettings({ pushToTalk: false })}
            >
              {t("comms_tx_mode_open")}
            </button>
          </div>
        </div>

        {#if controller.settings.pushToTalk}
          <div class="key-row">
            <span><strong>{t("comms_key_ptt_label")}</strong><small>{t("comms_key_ptt_desc")}</small></span>
            <button type="button" class:capturing={capturingKey} class="key-capture" onclick={() => (capturingKey = true)}>
              {capturingKey ? t("comms_key_press_key") : keyLabel(controller.settings.pushToTalkKey)}
            </button>
          </div>
        {/if}

        <label class="field-block" for="microphone-select">
          <span class="field-label">{t("comms_mic_select_label")}</span>
          <select
            id="microphone-select"
            value={controller.settings.microphoneId}
            onchange={(event) => controller.updateSettings({ microphoneId: event.currentTarget.value })}
          >
            <option value="">{t("comms_mic_default")}</option>
            {#each controller.microphones as microphone, index}
              <option value={microphone.deviceId}>
                {microphone.label || t("comms_mic_fallback", { index: index + 1 })}
              </option>
            {/each}
          </select>
        </label>

        <div class="field-block">
          <div class="volume-label">
            <span class="field-label">{t("comms_volume_voices")}</span>
            <strong>{Math.round(controller.settings.voiceVolume * 100)}%</strong>
          </div>
          <input
            aria-label={t("comms_volume_voices")}
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={controller.settings.voiceVolume}
            oninput={(event) => controller.updateSettings({ voiceVolume: Number(event.currentTarget.value) })}
          />
        </div>
      </section>
    </div>

    <footer class="settings-footer">
      <span>{t("comms_settings_saved_hint")}</span>
      <button type="button" class="primary-button" onclick={onClose}>{t("comms_settings_btn_done")}</button>
    </footer>
  </div>
</div>

<style>
  .settings-layer {
    position: fixed;
    inset: 0;
    z-index: 1200;
    pointer-events: auto;
    display: grid;
    place-items: center;
    padding: 20px;
    background: rgba(2, 5, 11, 0.78);
    backdrop-filter: blur(8px);
  }
  .settings-dialog {
    width: min(760px, 100%);
    max-height: min(820px, calc(100vh - 40px));
    overflow: hidden;
    display: flex;
    flex-direction: column;
    background: linear-gradient(155deg, #101a2d, #070c16 72%);
    border: 1px solid rgba(234, 179, 8, 0.55);
    border-radius: 8px;
    box-shadow: 0 30px 90px #000;
  }
  .settings-header,
  .settings-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 16px 20px;
    border-bottom: 1px solid rgba(212, 175, 55, 0.24);
  }
  .eyebrow {
    display: block;
    margin-bottom: 4px;
    color: #94a3b8;
    font-family: var(--font-mono);
    font-size: 0.6rem;
    letter-spacing: 0.12em;
  }
  h3 {
    display: flex;
    align-items: center;
    gap: 8px;
    color: #fef08a;
    font-family: var(--font-display);
    font-size: 1rem;
  }
  .icon-button {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    padding: 0;
    background: transparent;
  }
  .settings-content {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 22px;
    padding: 20px;
    overflow-y: auto;
  }
  .settings-section {
    display: flex;
    flex-direction: column;
    min-width: 0;
    gap: 8px;
  }
  h4 {
    margin-bottom: 5px;
    color: #eab308;
    font-family: var(--font-tactical);
    font-size: 0.75rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }
  .size-field-block {
    padding: 10px;
    background: rgba(15, 23, 42, 0.58);
    border: 1px solid rgba(234, 179, 8, 0.28);
    border-radius: 5px;
  }
  .size-field-header {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .toggle-row,
  .key-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px;
    background: rgba(15, 23, 42, 0.58);
    border: 1px solid rgba(148, 163, 184, 0.15);
    border-radius: 5px;
    min-width: 0;
  }
  .toggle-row > span,
  .key-row > span {
    display: flex;
    flex-direction: column;
    min-width: 0;
    gap: 2px;
  }
  strong {
    color: #e2e8f0;
    font-size: 0.76rem;
  }
  small {
    color: #94a3b8;
    font-size: 0.65rem;
    line-height: 1.3;
  }
  input[type="checkbox"] {
    appearance: none;
    flex: 0 0 auto;
    width: 34px;
    height: 18px;
    padding: 2px;
    border-radius: 20px;
    background: #1e293b;
    cursor: pointer;
  }
  input[type="checkbox"]::after {
    content: "";
    display: block;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: #94a3b8;
    transition: transform 0.15s, background 0.15s;
  }
  input[type="checkbox"]:checked {
    background: #a16207;
    border-color: #eab308;
  }
  input[type="checkbox"]:checked::after {
    transform: translateX(16px);
    background: #fef08a;
  }
  .field-block {
    display: flex;
    flex-direction: column;
    gap: 7px;
    padding: 10px 0;
    min-width: 0;
  }
  .field-label {
    color: #cbd5e1;
    font-family: var(--font-tactical);
    font-size: 0.74rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .segmented-control {
    display: flex;
    padding: 3px;
    background: #050912;
    border: 1px solid rgba(148, 163, 184, 0.2);
    border-radius: 5px;
    gap: 3px;
  }
  .segmented-control button {
    flex: 1;
    min-width: 0;
    padding: 7px 6px;
    border: 0;
    background: transparent;
    color: #94a3b8;
    font-size: 0.7rem;
  }
  .segmented-control button.active {
    background: rgba(202, 138, 4, 0.25);
    color: #fef08a;
  }
  .key-capture {
    min-width: 96px;
    flex-shrink: 0;
    color: #fef08a;
    font-family: var(--font-mono);
    font-size: 0.7rem;
  }
  .key-capture.capturing {
    border-color: #eab308;
    animation: pulse 1s infinite alternate;
  }
  select {
    width: 100%;
    font-size: 0.75rem;
  }
  .volume-label {
    display: flex;
    justify-content: space-between;
  }
  .volume-label strong {
    color: #fde047;
    font-family: var(--font-mono);
  }
  .settings-footer {
    border-top: 1px solid rgba(212, 175, 55, 0.24);
    border-bottom: 0;
    color: #94a3b8;
    font-size: 0.68rem;
  }
  .primary-button {
    background: linear-gradient(135deg, #eab308, #a16207);
    border-color: #fef08a;
    color: #090d16;
  }
  @keyframes pulse {
    to { box-shadow: 0 0 12px rgba(234, 179, 8, 0.4); }
  }
  @media (max-width: 680px) {
    .settings-content { grid-template-columns: 1fr; }
    .settings-footer { align-items: flex-end; }
  }
</style>
