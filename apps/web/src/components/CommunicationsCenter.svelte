<script lang="ts">
  import { tick } from "svelte";
  import { GLOBAL_CHANNEL_ID } from "@hegemonia/shared";
  import type { CommunicationsController } from "../lib/communications.svelte";
  import { i18n, t } from "../i18n/index.svelte";
  import Avatar from "./Avatar.svelte";
  import CommunicationSettings from "./CommunicationSettings.svelte";
  import FactionFlag from "./FactionFlag.svelte";
  import Icon from "./Icon.svelte";

  let {
    controller,
    compact = false,
  }: {
    controller: CommunicationsController;
    compact?: boolean;
  } = $props();

  let settingsOpen = $state(false);
  let newChannelOpen = $state(false);
  let messagesElement = $state<HTMLDivElement | null>(null);

  let availablePlayers = $derived(
    controller.players.filter(
      (player) => player.connected && !player.isBot && player.token !== controller.myPlayerId
    )
  );
  let activeChannel = $derived(controller.channelById(controller.activeChannelId));
  let activeVoiceParticipants = $derived(
    controller.voicePresence[controller.activeChannelId] ?? []
  );
  let isActiveLine = $derived(controller.activeVoiceChannelId === controller.activeChannelId);

  $effect(() => {
    controller.activeChannelId;
    controller.activeMessages.length;
    void tick().then(() => {
      messagesElement?.scrollTo({ top: messagesElement.scrollHeight, behavior: "smooth" });
    });
  });

  function submit(): void {
    const text = controller.drafts[controller.activeChannelId] ?? "";
    if (!text.trim()) return;
    controller.send(text);
  }

  function composerKeydown(event: KeyboardEvent): void {
    if (event.key !== "Enter") return;
    const shouldSend = controller.settings.enterToSend
      ? !event.shiftKey
      : event.ctrlKey || event.metaKey;
    if (!shouldSend) return;
    event.preventDefault();
    submit();
  }

  function globalKeydown(event: KeyboardEvent): void {
    if (
      settingsOpen ||
      !controller.activeVoiceChannelId ||
      !controller.settings.pushToTalk ||
      event.code !== controller.settings.pushToTalkKey ||
      event.repeat
    ) {
      return;
    }
    const target = event.target as HTMLElement | null;
    if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
    event.preventDefault();
    controller.setTransmitting(true);
  }

  function globalKeyup(event: KeyboardEvent): void {
    if (event.code !== controller.settings.pushToTalkKey) return;
    controller.setTransmitting(false);
  }

  function formatTime(isoDate: string): string {
    return i18n.formatTimeShort(isoDate);
  }

  function openDirect(playerId: string): void {
    controller.openDirect(playerId);
    newChannelOpen = false;
  }
</script>

<svelte:window onkeydown={globalKeydown} onkeyup={globalKeyup} />

<section
  class="communications-center size-{controller.settings.chatSize}"
  class:compact={compact && controller.settings.chatSize === "normal"}
  aria-label={t("comms_settings_title")}
>
  <header class="comms-toolbar">
    <div class="channel-tabs" role="tablist" aria-label={t("comms_line_tactical_radio")}>
      {#each controller.openTabIds as channelId (channelId)}
        {@const channel = controller.channelById(channelId)}
        {@const other = channel ? controller.otherPlayer(channel) : undefined}
        <div class="channel-tab" class:active={controller.activeChannelId === channelId}>
          <button
            class="channel-select"
            role="tab"
            aria-selected={controller.activeChannelId === channelId}
            onclick={() => controller.selectChannel(channelId)}
          >
            {#if channelId === GLOBAL_CHANNEL_ID}
              <Icon name="globe" size={12} />
            {:else if controller.settings.showAvatars && other}
              <Avatar name={other.name} avatarUrl={other.avatarUrl} size="small" />
            {:else}
              <Icon name="lock" size={11} />
            {/if}
            <span>{channelId === GLOBAL_CHANNEL_ID ? t("comms_channel_global") : controller.channelTitle(channelId)}</span>
            {#if (controller.unreadByChannel[channelId] ?? 0) > 0}
              <strong class="unread-badge">{controller.unreadByChannel[channelId]}</strong>
            {/if}
          </button>
          {#if channelId !== GLOBAL_CHANNEL_ID && controller.activeVoiceChannelId !== channelId}
            <button
              class="close-tab"
              onclick={() => controller.closeChannel(channelId)}
              aria-label={t("comms_close_tab", { title: controller.channelTitle(channelId) })}
            >
              <Icon name="close" size={10} />
            </button>
          {/if}
        </div>
      {/each}
    </div>

    <div class="toolbar-actions">
      <div class="new-channel-wrap">
        <button
          class="toolbar-button"
          class:active={newChannelOpen}
          onclick={() => (newChannelOpen = !newChannelOpen)}
          aria-label={t("comms_open_direct_tab")}
          title={t("comms_open_direct_tab")}
        >
          <Icon name="plus" size={14} />
        </button>
        {#if newChannelOpen}
          <div class="player-picker">
            <div class="picker-title">{t("comms_open_direct_tab")}</div>
            {#each availablePlayers as player}
              <button onclick={() => openDirect(player.token)}>
                <Avatar name={player.name} avatarUrl={player.avatarUrl} size="small" />
                <span><strong>{player.name}</strong><small>{t("comms_bilateral_channel")}</small></span>
                <Icon name="radio" size={13} />
              </button>
            {:else}
              <p>{t("comms_no_human_players")}</p>
            {/each}
          </div>
        {/if}
      </div>
      <button
        class="toolbar-button"
        class:active={controller.settings.chatSize !== "normal"}
        onclick={() => controller.cycleChatSize()}
        aria-label={t("comms_toggle_chat_size")}
        title={`${t("comms_chat_size_label")}: ${controller.settings.chatSize === "normal" ? t("comms_size_normal") : controller.settings.chatSize === "large" ? t("comms_size_large") : t("comms_size_expanded")}`}
      >
        <Icon name={controller.settings.chatSize === "expanded" ? "minimize" : "expand"} size={13} />
      </button>
      <button
        class="toolbar-button"
        onclick={() => (settingsOpen = true)}
        aria-label={t("comms_settings_title")}
        title={t("comms_settings_title")}
      >
        <Icon name="settings" size={14} />
      </button>
    </div>
  </header>

  <div class="channel-status-line">
    <span class:private={activeChannel?.kind !== "global"}>
      <Icon name={activeChannel?.kind === "global" || !activeChannel ? "globe" : "lock"} size={10} />
      {activeChannel?.kind === "direct" ? t("comms_status_direct_auth") : t("comms_status_public_net")}
    </span>
    <small>{activeChannel?.kind === "direct" ? t("comms_status_direct_hint") : t("comms_status_public_hint")}</small>
  </div>

  <div class="radio-console" class:line-active={isActiveLine}>
    <div class="radio-identity">
      <span class="radio-signal"><Icon name="radio" size={15} /></span>
      <div>
        <strong>{isActiveLine ? t("comms_line_active") : t("comms_line_tactical_radio")}</strong>
        <small>
          {#if controller.radioConnection === "connecting" && isActiveLine}
            {t("comms_radio_connecting")}
          {:else if controller.radioConnection === "failed" && isActiveLine}
            {t("comms_radio_failed")}
          {:else}
            {t("comms_radio_count_participants", { count: activeVoiceParticipants.length })}
          {/if}
        </small>
      </div>
    </div>

    {#if isActiveLine}
      <div class="voice-participants" aria-label={t("comms_line_active")}>
        {#each activeVoiceParticipants as playerId}
          {@const player = controller.playerById(playerId)}
          {#if player}
            <span class="voice-avatar" class:speaking={controller.speakingByPlayer[playerId]} title={player.name}>
              <Avatar name={player.name} avatarUrl={player.avatarUrl} size="small" />
            </span>
          {/if}
        {/each}
      </div>
      <button
        class="radio-control"
        class:muted={controller.radioMuted}
        onclick={() => controller.toggleRadioMute()}
        title={controller.radioMuted ? t("comms_btn_unmute") : t("comms_btn_mute")}
        aria-label={controller.radioMuted ? t("comms_btn_unmute") : t("comms_btn_mute")}
      >
        <Icon name={controller.radioMuted ? "mute" : "microphone"} size={14} />
      </button>
      {#if controller.settings.pushToTalk}
        <button
          class="ptt-button"
          class:muted={controller.radioMuted}
          disabled={controller.radioMuted}
          onpointerdown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            controller.setTransmitting(true);
          }}
          onpointerup={() => controller.setTransmitting(false)}
          onpointercancel={() => controller.setTransmitting(false)}
          onpointerleave={() => controller.setTransmitting(false)}
        >
          <Icon name="microphone" size={13} /> {t("comms_btn_ptt")}
        </button>
      {:else}
        <span class="open-mic-label" class:muted={controller.radioMuted}>
          {controller.radioMuted ? t("comms_state_muted") : t("comms_state_open_mic")}
        </span>
      {/if}
      <button class="radio-control leave-line" onclick={() => controller.leaveVoice()} title={t("comms_btn_leave_line")}>
        <Icon name="close" size={14} />
      </button>
    {:else}
      <button class="join-line-button" onclick={() => void controller.joinVoice(controller.activeChannelId)}>
        <Icon name="microphone" size={13} />
        {controller.activeVoiceChannelId ? t("comms_btn_switch_line") : t("comms_btn_join_line")}
      </button>
    {/if}
  </div>

  {#if controller.error}
    <div class="comms-error" role="alert">
      <span>{controller.error}</span>
      <button onclick={() => controller.clearError()} aria-label={t("comms_dismiss_error")}><Icon name="close" size={12} /></button>
    </div>
  {/if}

  <div class="messages-scroller" bind:this={messagesElement} role="log" aria-live="polite">
    {#each controller.activeMessages as message (message.id)}
      {#if message.kind === "intel"}
        <div class="intel-message">
          <span class="intel-icon"><Icon name="radio" size={13} /></span>
          <div>
            <strong>{t("comms_intel_banner")}</strong>
            <p>{message.text}</p>
          </div>
          {#if controller.settings.showTimestamps}<time>{formatTime(message.createdAt)}</time>{/if}
        </div>
      {:else}
        {@const sender = controller.playerById(message.senderId)}
        <article class="chat-message" class:own-message={message.senderId === controller.myPlayerId}>
          {#if controller.settings.showAvatars}
            <Avatar
              name={message.senderName}
              avatarUrl={message.senderAvatarUrl ?? sender?.avatarUrl}
              size="small"
            />
          {/if}
          <div class="message-body">
            <header>
              <span class="sender-name">
                {#if message.senderColor}<FactionFlag color={message.senderColor} width={14} height={9} />{/if}
                {message.senderName}
                {#if message.senderId === controller.myPlayerId}<small>{t("comms_msg_you")}</small>{/if}
              </span>
              {#if controller.settings.showTimestamps}<time>{formatTime(message.createdAt)}</time>{/if}
            </header>
            <p>{message.text}</p>
          </div>
        </article>
      {/if}
    {:else}
      <div class="empty-channel">
        <Icon name={activeChannel?.kind === "direct" ? "lock" : "radio"} size={22} />
        <strong>{activeChannel?.kind === "direct" ? t("comms_empty_direct_title") : t("comms_empty_global_title")}</strong>
        <p>
          {activeChannel?.kind === "direct"
            ? t("comms_empty_direct_desc")
            : t("comms_empty_global_desc")}
        </p>
      </div>
    {/each}
  </div>

  <div class="composer-wrap">
    <textarea
      rows="1"
      maxlength="240"
      placeholder={activeChannel?.kind === "direct"
        ? t("comms_placeholder_direct", { target: controller.channelTitle(controller.activeChannelId) })
        : t("comms_placeholder_global")}
      aria-label={t("comms_placeholder_global")}
      value={controller.drafts[controller.activeChannelId] ?? ""}
      oninput={(event) => controller.setDraft(event.currentTarget.value)}
      onkeydown={composerKeydown}
    ></textarea>
    <div class="composer-actions">
      <small>{(controller.drafts[controller.activeChannelId] ?? "").length}/240</small>
      <button
        class="send-button"
        disabled={!(controller.drafts[controller.activeChannelId] ?? "").trim()}
        onclick={submit}
        aria-label={t("comms_btn_send")}
      >
        <Icon name="send" size={14} /> <span>{t("comms_btn_send")}</span>
      </button>
    </div>
  </div>
</section>

{#if settingsOpen}
  <CommunicationSettings {controller} onClose={() => (settingsOpen = false)} />
{/if}

<style>
  .communications-center {
    position: relative;
    display: flex;
    flex-direction: column;
    min-height: 0;
    height: 100%;
    color: #e2e8f0;
  }
  .comms-toolbar {
    display: flex;
    align-items: center;
    gap: 5px;
    min-height: 31px;
  }
  .channel-tabs {
    display: flex;
    flex: 1;
    min-width: 0;
    gap: 3px;
    overflow-x: auto;
    padding-bottom: 2px;
  }
  .channel-tab {
    display: flex;
    align-items: center;
    flex: 0 0 auto;
    max-width: 150px;
    background: rgba(15, 23, 42, 0.66);
    border: 1px solid rgba(148, 163, 184, 0.18);
    border-radius: 4px;
  }
  .channel-tab.active {
    background: rgba(202, 138, 4, 0.18);
    border-color: rgba(234, 179, 8, 0.58);
  }
  .channel-select {
    display: flex;
    align-items: center;
    gap: 5px;
    min-width: 0;
    max-width: 132px;
    padding: 4px 6px;
    border: 0;
    background: transparent;
    color: #94a3b8;
    font-size: 0.67rem;
  }
  .channel-tab.active .channel-select { color: #fef08a; }
  .channel-select > span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .channel-select :global(.avatar) {
    width: 18px;
    height: 18px;
    font-size: 0.45rem;
    border-radius: 2px;
  }
  .unread-badge {
    min-width: 16px;
    padding: 0 4px;
    border-radius: 8px;
    background: #0891b2;
    color: white;
    font-family: var(--font-mono);
    font-size: 0.56rem;
    text-align: center;
  }
  .close-tab {
    display: grid;
    place-items: center;
    width: 18px;
    height: 22px;
    padding: 0;
    border: 0;
    background: transparent;
    color: #64748b;
  }
  .toolbar-actions { display: flex; gap: 3px; }
  .toolbar-button {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    padding: 0;
    background: rgba(15, 23, 42, 0.75);
    color: #cbd5e1;
  }
  .toolbar-button.active { border-color: #eab308; color: #fef08a; }
  .new-channel-wrap { position: relative; }
  .player-picker {
    position: absolute;
    top: 34px;
    right: 0;
    z-index: 40;
    width: 260px;
    padding: 7px;
    background: #0b1322;
    border: 1px solid rgba(234, 179, 8, 0.48);
    border-radius: 6px;
    box-shadow: 0 14px 35px #000;
  }
  .picker-title {
    padding: 5px 6px 8px;
    color: #eab308;
    font-family: var(--font-tactical);
    font-size: 0.62rem;
    font-weight: 800;
    letter-spacing: 0.1em;
  }
  .player-picker > button {
    display: flex;
    align-items: center;
    width: 100%;
    gap: 9px;
    padding: 7px;
    border: 0;
    border-top: 1px solid rgba(148, 163, 184, 0.12);
    background: transparent;
    text-align: left;
  }
  .player-picker > button > span { display: flex; flex: 1; flex-direction: column; }
  .player-picker strong { color: #f1f5f9; font-size: 0.75rem; }
  .player-picker small { color: #94a3b8; font-size: 0.62rem; }
  .player-picker p { padding: 12px; color: #94a3b8; font-size: 0.7rem; text-align: center; }
  .channel-status-line {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 4px 2px;
    color: #38bdf8;
  }
  .channel-status-line > span {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-family: var(--font-tactical);
    font-size: 0.56rem;
    font-weight: 800;
    letter-spacing: 0.08em;
  }
  .channel-status-line > span.private { color: #eab308; }
  .channel-status-line small { color: #64748b; font-size: 0.56rem; }
  .radio-console {
    display: flex;
    align-items: center;
    gap: 5px;
    min-height: 42px;
    padding: 5px 6px;
    background: linear-gradient(90deg, rgba(8, 20, 33, 0.95), rgba(15, 23, 42, 0.75));
    border: 1px solid rgba(56, 189, 248, 0.22);
    border-radius: 5px;
  }
  .radio-console.line-active {
    background: linear-gradient(90deg, rgba(6, 78, 59, 0.35), rgba(15, 23, 42, 0.82));
    border-color: rgba(16, 185, 129, 0.45);
  }
  .radio-identity {
    display: flex;
    align-items: center;
    flex: 1;
    min-width: 0;
    gap: 6px;
  }
  .radio-signal { color: #38bdf8; }
  .line-active .radio-signal { color: #34d399; }
  .radio-identity > div { display: flex; flex-direction: column; min-width: 0; }
  .radio-identity strong {
    color: #e2e8f0;
    font-family: var(--font-tactical);
    font-size: 0.62rem;
    letter-spacing: 0.09em;
  }
  .radio-identity small {
    overflow: hidden;
    color: #64748b;
    font-size: 0.55rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .voice-participants { display: flex; }
  .voice-avatar {
    display: inline-flex;
    margin-left: -5px;
    border-radius: 4px;
  }
  .voice-avatar :global(.avatar) { width: 24px; height: 24px; font-size: 0.52rem; }
  .voice-avatar.speaking :global(.avatar) {
    border-color: #6ee7b7;
    box-shadow: 0 0 10px rgba(16, 185, 129, 0.85);
  }
  .radio-control {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    padding: 0;
    background: rgba(5, 9, 18, 0.7);
  }
  .radio-control.muted { color: #fca5a5; border-color: #ef4444; }
  .leave-line { color: #fca5a5; }
  .ptt-button,
  .join-line-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    padding: 5px 8px;
    font-size: 0.6rem;
    white-space: nowrap;
  }
  .ptt-button {
    background: linear-gradient(135deg, #059669, #065f46);
    border-color: #34d399;
    color: white;
    touch-action: none;
  }
  .ptt-button:active { background: #10b981; box-shadow: 0 0 12px rgba(16, 185, 129, 0.5); }
  .ptt-button.muted { background: #1e293b; border-color: #475569; }
  .open-mic-label {
    color: #6ee7b7;
    font-family: var(--font-tactical);
    font-size: 0.57rem;
    font-weight: 800;
    white-space: nowrap;
  }
  .open-mic-label.muted { color: #fca5a5; }
  .join-line-button { background: rgba(8, 145, 178, 0.2); border-color: #0891b2; color: #a5f3fc; }
  .comms-error {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 5px;
    padding: 4px 7px;
    background: rgba(127, 29, 29, 0.45);
    border-left: 2px solid #ef4444;
    color: #fecaca;
    font-size: 0.62rem;
  }
  .comms-error button { padding: 2px; border: 0; background: transparent; color: #fecaca; }
  .messages-scroller {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-height: 100px;
    gap: 6px;
    overflow-y: auto;
    padding: 7px 3px 7px 0;
    user-select: text;
  }
  .chat-message {
    display: flex;
    align-items: flex-start;
    gap: 7px;
    padding: 5px 6px;
    background: rgba(15, 23, 42, 0.48);
    border-left: 2px solid #334155;
    border-radius: 3px;
  }
  .chat-message.own-message { background: rgba(202, 138, 4, 0.09); border-left-color: #a16207; }
  .chat-message > :global(.avatar) { width: 27px; height: 27px; font-size: 0.56rem; }
  .message-body { flex: 1; min-width: 0; }
  .message-body header { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
  .sender-name {
    display: inline-flex;
    align-items: center;
    min-width: 0;
    gap: 5px;
    color: #f1f5f9;
    font-family: var(--font-tactical);
    font-size: 0.67rem;
    font-weight: 700;
  }
  .sender-name small { color: #eab308; font-family: var(--font-mono); font-size: 0.48rem; }
  time { color: #64748b; font-family: var(--font-mono); font-size: 0.54rem; }
  .message-body p { margin-top: 2px; color: #cbd5e1; font-size: 0.7rem; line-height: 1.35; overflow-wrap: anywhere; white-space: pre-wrap; }
  .intel-message {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 6px 8px;
    background: repeating-linear-gradient(135deg, rgba(8, 145, 178, 0.1), rgba(8, 145, 178, 0.1) 8px, rgba(15, 23, 42, 0.5) 8px, rgba(15, 23, 42, 0.5) 16px);
    border: 1px solid rgba(56, 189, 248, 0.25);
    border-left: 2px solid #38bdf8;
    border-radius: 3px;
  }
  .intel-icon { color: #38bdf8; }
  .intel-message > div { flex: 1; }
  .intel-message strong { color: #7dd3fc; font-family: var(--font-tactical); font-size: 0.56rem; letter-spacing: 0.1em; }
  .intel-message p { color: #bae6fd; font-size: 0.66rem; }
  .empty-channel {
    display: flex;
    align-items: center;
    flex: 1;
    flex-direction: column;
    justify-content: center;
    gap: 6px;
    padding: 15px;
    color: #475569;
    text-align: center;
  }
  .empty-channel strong { color: #94a3b8; font-family: var(--font-tactical); font-size: 0.72rem; }
  .empty-channel p { max-width: 270px; color: #64748b; font-size: 0.65rem; line-height: 1.4; }
  .composer-wrap {
    display: flex;
    align-items: flex-end;
    gap: 5px;
    padding-top: 5px;
    border-top: 1px solid rgba(148, 163, 184, 0.14);
  }
  textarea {
    flex: 1;
    min-width: 0;
    min-height: 34px;
    max-height: 72px;
    resize: vertical;
    padding: 7px 8px;
    font-size: 0.7rem;
    line-height: 1.3;
  }
  .composer-actions { display: flex; align-items: center; gap: 5px; }
  .composer-actions > small { color: #475569; font-family: var(--font-mono); font-size: 0.5rem; }
  .send-button {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    min-height: 34px;
    padding: 6px 8px;
    background: linear-gradient(135deg, #eab308, #a16207);
    border-color: #fde047;
    color: #090d16;
    font-size: 0.63rem;
  }
  .compact .radio-identity small { display: none; }
  .compact .channel-status-line small { display: none; }
  .compact .messages-scroller { min-height: 90px; }

  /* Size: Large */
  .communications-center.size-large .channel-select {
    font-size: 0.74rem;
    max-width: 165px;
    padding: 5px 8px;
  }
  .communications-center.size-large .channel-tab {
    max-width: 185px;
  }
  .communications-center.size-large .sender-name {
    font-size: 0.75rem;
  }
  .communications-center.size-large .message-body p {
    font-size: 0.79rem;
    line-height: 1.42;
  }
  .communications-center.size-large .intel-message p {
    font-size: 0.74rem;
  }
  .communications-center.size-large textarea {
    font-size: 0.78rem;
    min-height: 40px;
  }
  .communications-center.size-large .send-button {
    min-height: 40px;
    font-size: 0.7rem;
    padding: 6px 11px;
  }

  /* Size: Expanded */
  .communications-center.size-expanded .channel-select {
    font-size: 0.78rem;
    max-width: 195px;
    padding: 6px 10px;
  }
  .communications-center.size-expanded .channel-tab {
    max-width: 220px;
  }
  .communications-center.size-expanded .chat-message {
    padding: 8px 10px;
    gap: 10px;
  }
  .communications-center.size-expanded .chat-message > :global(.avatar) {
    width: 32px;
    height: 32px;
    font-size: 0.65rem;
  }
  .communications-center.size-expanded .sender-name {
    font-size: 0.82rem;
  }
  .communications-center.size-expanded time {
    font-size: 0.62rem;
  }
  .communications-center.size-expanded .message-body p {
    font-size: 0.86rem;
    line-height: 1.46;
  }
  .communications-center.size-expanded .intel-message p {
    font-size: 0.78rem;
  }
  .communications-center.size-expanded textarea {
    font-size: 0.84rem;
    min-height: 44px;
    padding: 8px 10px;
  }
  .communications-center.size-expanded .send-button {
    min-height: 44px;
    font-size: 0.74rem;
    padding: 7px 13px;
  }

  @media (max-width: 520px) {
    .radio-identity small, .voice-participants, .send-button span { display: none; }
    .channel-status-line small { display: none; }
    .channel-tab { max-width: 120px; }
  }
</style>
