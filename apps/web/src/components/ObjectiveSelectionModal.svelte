<script lang="ts">
  import { onDestroy } from "svelte";
  import type { DoctrineId, ObjectiveCard } from "@hegemonia/shared";
  import { t, i18n } from "../i18n/index.svelte";
  import { getFactionDoctrine, getObjectiveTitle, getObjectiveDescription } from "../i18n/content.svelte";
  import DoctrineCrest from "./DoctrineCrest.svelte";
  import Icon from "./Icon.svelte";

  interface Props {
    availableObjectives: ObjectiveCard[];
    doctrineId?: DoctrineId | null;
    onSelect: (objectiveId: string) => void;
    onPreviewObjective?: (objective: ObjectiveCard | null) => void;
  }

  let { availableObjectives, doctrineId, onSelect, onPreviewObjective }: Props = $props();

  let chosenId = $state<string | null>(null);
  let hoveredId = $state<string | null>(null);
  let collapsed = $state<boolean>(true);
  let selectedObjectiveId = $derived(chosenId ?? availableObjectives[0]?.id ?? null);
  let previewedObjective = $derived(
    availableObjectives.find((o) => o.id === (hoveredId ?? selectedObjectiveId)) ?? null
  );

  $effect(() => {
    onPreviewObjective?.(previewedObjective);
  });

  onDestroy(() => {
    onPreviewObjective?.(null);
  });

  function hasDoctrineAffinity(obj: ObjectiveCard, docId?: DoctrineId | null): boolean {
    if (!docId) return false;
    if (docId === "extermination") return obj.rule.type === "eliminate_players";
    if (obj.allowedDoctrines && obj.allowedDoctrines.includes(docId)) return true;
    return false;
  }

  function confirmSelection() {
    if (selectedObjectiveId) {
      onSelect(selectedObjectiveId);
    }
  }
</script>

<aside class="objective-toast-wrapper" role="region" aria-label={t("objective_selection_title")}>
  {#if collapsed}
    <div class="objective-toast-pill-bar">
      <div class="card-corner tl"></div>
      <div class="card-corner tr"></div>
      <div class="card-corner bl"></div>
      <div class="card-corner br"></div>

      <div class="pill-info">
        <Icon name="target" size={15} color="#eab308" />
        <span class="pill-warning-text">{t("objective_selection_pill_warning")}</span>
        {#if doctrineId}
          <span class="pill-doctrine-tag">
            <DoctrineCrest {doctrineId} size={14} />
            <span>{getFactionDoctrine(doctrineId)}</span>
          </span>
        {/if}
      </div>

      <button
        type="button"
        class="pill-expand-btn"
        onclick={() => (collapsed = false)}
        title={t("objective_selection_choose_btn_title")}
      >
        <Icon name="target" size={13} />
        <span>{t("objective_selection_choose_btn", { count: availableObjectives.length })}</span>
        <Icon name="chevron-down" size={13} />
      </button>
    </div>
  {:else}
    <div class="objective-toast-card">
      <div class="card-corner tl"></div>
      <div class="card-corner tr"></div>
      <div class="card-corner bl"></div>
      <div class="card-corner br"></div>

      <header class="toast-header">
        <div class="header-main">
          <div class="header-badge">
            <Icon name="target" size={16} />
            <span>{t("objective_selection_badge")}</span>
          </div>
          <h2 id="obj-modal-title">{t("objective_selection_title")}</h2>
          <p class="toast-subtitle">
            {t("objective_selection_desc", {
              doctrine: doctrineId ? getFactionDoctrine(doctrineId) : t("objective_selection_general")
            })}
          </p>
        </div>

        <button
          type="button"
          class="btn-minimize-toast"
          title={t("inspect_map_title")}
          onclick={() => (collapsed = true)}
        >
          <Icon name="eye" size={14} />
          <span>{t("inspect_map")}</span>
          <Icon name="chevron-up" size={14} />
        </button>
      </header>

      <div class="objectives-grid">
        {#each availableObjectives as obj, idx}
          {@const isSelected = selectedObjectiveId === obj.id}
          {@const isAffinity = hasDoctrineAffinity(obj, doctrineId) || (idx === 0 && !!doctrineId)}
          <button
            type="button"
            class="objective-card-option"
            class:selected={isSelected}
            class:affinity-card={isAffinity}
            onclick={() => (chosenId = obj.id)}
            onmouseenter={() => (hoveredId = obj.id)}
            onmouseleave={() => {
              if (hoveredId === obj.id) hoveredId = null;
            }}
            onfocus={() => (hoveredId = obj.id)}
            onblur={() => {
              if (hoveredId === obj.id) hoveredId = null;
            }}
          >
            <div class="obj-card-top">
              <span class="obj-type-badge">
                <Icon name="shield" size={13} />
                {getObjectiveTitle(obj)}
              </span>
              {#if isSelected}
                <span class="selected-pill">
                  <Icon name="check" size={12} /> {t("selected")}
                </span>
              {/if}
            </div>

            <p class="obj-description">
              {getObjectiveDescription(obj)}
            </p>

            <div class="obj-footer-meta">
              {#if isAffinity}
                <div class="doctrine-affinity">
                  <DoctrineCrest {doctrineId} size={16} />
                  <span>{t("doctrine_affinity_approved")}</span>
                  <!-- Compatibilidade Tática Aprovada -->
                </div>
              {:else}
                <div class="doctrine-standard">
                  <Icon name="cards" size={14} />
                  <span>{t("doctrine_standard_directive")}</span>
                </div>
              {/if}
            </div>
          </button>
        {/each}
      </div>

      <footer class="toast-footer">
        <div class="footer-note">
          <Icon name="clock" size={14} />
          <span>{t("objective_selection_auto_note")}</span>
        </div>
        <button
          type="button"
          class="confirm-objective-btn"
          disabled={!selectedObjectiveId}
          onclick={confirmSelection}
        >
          <Icon name="target" size={16} />
          <span>{t("objective_selection_confirm")}</span>
        </button>
      </footer>
    </div>
  {/if}
</aside>

<style>
  .objective-toast-wrapper {
    position: fixed;
    top: 92px;
    left: 50%;
    transform: translateX(-50%);
    width: min(880px, 94vw);
    z-index: 90;
    pointer-events: none;
    animation: slideDown 0.22s cubic-bezier(0.16, 1, 0.3, 1);
  }

  .card-corner {
    position: absolute;
    width: 10px;
    height: 10px;
    border-color: #eab308;
    border-style: solid;
    pointer-events: none;
    z-index: 2;
  }
  .card-corner.tl { top: -1px; left: -1px; border-width: 2px 0 0 2px; }
  .card-corner.tr { top: -1px; right: -1px; border-width: 2px 2px 0 0; }
  .card-corner.bl { bottom: -1px; left: -1px; border-width: 0 0 2px 2px; }
  .card-corner.br { bottom: -1px; right: -1px; border-width: 0 2px 2px 0; }

  /* Pill Bar (Collapsed Mode) */
  .objective-toast-pill-bar {
    pointer-events: auto;
    position: relative;
    background: linear-gradient(135deg, rgba(15, 23, 42, 0.96), rgba(9, 14, 26, 0.96));
    border: 1px solid rgba(234, 179, 8, 0.55);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.65), 0 0 16px rgba(234, 179, 8, 0.15);
    border-radius: 6px;
    padding: 8px 16px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
  }

  .pill-info {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }

  .pill-warning-text {
    font-family: var(--font-tactical);
    font-size: 0.78rem;
    font-weight: 800;
    letter-spacing: 0.08em;
    color: #fbbf24;
  }

  .pill-doctrine-tag {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 2px 8px;
    background: rgba(234, 179, 8, 0.12);
    border: 1px solid rgba(234, 179, 8, 0.35);
    border-radius: 4px;
    font-family: var(--font-tactical);
    font-size: 0.7rem;
    font-weight: 700;
    color: #fde047;
  }

  .pill-expand-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 14px;
    background: linear-gradient(135deg, #eab308 0%, #ca8a04 100%);
    border: 1px solid #fde047;
    border-radius: 4px;
    color: #0f172a;
    font-family: var(--font-tactical);
    font-weight: 800;
    font-size: 0.75rem;
    letter-spacing: 0.06em;
    cursor: pointer;
    box-shadow: 0 2px 8px rgba(234, 179, 8, 0.3);
    transition: all 0.15s ease;
    white-space: nowrap;
  }

  .pill-expand-btn:hover {
    background: linear-gradient(135deg, #facc15 0%, #d97706 100%);
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(234, 179, 8, 0.45);
  }

  /* Full Toast Card */
  .objective-toast-card {
    pointer-events: auto;
    position: relative;
    width: 100%;
    background: linear-gradient(145deg, rgba(15, 23, 42, 0.98), rgba(9, 14, 26, 0.98));
    border: 1px solid rgba(234, 179, 8, 0.55);
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.8), 0 0 24px rgba(234, 179, 8, 0.18);
    border-radius: 8px;
    padding: 22px 24px;
    display: flex;
    flex-direction: column;
    gap: 16px;
    max-height: calc(100vh - 120px);
    overflow-y: auto;
  }

  .toast-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
  }

  .header-main {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  .header-badge {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    color: #eab308;
    font-family: var(--font-tactical);
    font-size: 0.72rem;
    font-weight: 800;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  .toast-header h2 {
    margin: 0;
    font-family: var(--font-display);
    font-size: 1.35rem;
    font-weight: 900;
    letter-spacing: 0.04em;
    color: #f8fafc;
  }

  .toast-subtitle {
    margin: 0;
    font-size: 0.82rem;
    color: #94a3b8;
    line-height: 1.4;
  }

  .btn-minimize-toast {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    background: rgba(30, 41, 59, 0.7);
    border: 1px solid rgba(148, 163, 184, 0.3);
    border-radius: 4px;
    color: #cbd5e1;
    font-family: var(--font-tactical);
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.05em;
    cursor: pointer;
    white-space: nowrap;
    transition: all 0.15s ease;
    flex-shrink: 0;
  }

  .btn-minimize-toast:hover {
    background: rgba(51, 65, 85, 0.85);
    border-color: rgba(234, 179, 8, 0.6);
    color: #f8fafc;
  }

  /* Grid Options */
  .objectives-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 14px;
  }

  .objective-card-option {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    gap: 12px;
    padding: 16px;
    background: rgba(15, 23, 42, 0.7);
    border: 1px solid rgba(148, 163, 184, 0.25);
    border-radius: 6px;
    text-align: left;
    cursor: pointer;
    transition: all 0.18s ease;
  }

  .objective-card-option:hover {
    background: rgba(30, 41, 59, 0.8);
    border-color: rgba(234, 179, 8, 0.6);
    transform: translateY(-2px);
  }

  .objective-card-option.affinity-card {
    border-color: rgba(234, 179, 8, 0.4);
    background: linear-gradient(145deg, rgba(30, 41, 59, 0.75), rgba(15, 23, 42, 0.75));
  }

  .objective-card-option.selected {
    background: linear-gradient(145deg, rgba(30, 41, 59, 0.95), rgba(15, 23, 42, 0.95));
    border-color: #eab308;
    box-shadow: 0 0 20px rgba(234, 179, 8, 0.25);
  }

  .obj-card-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .obj-type-badge {
    font-family: var(--font-tactical);
    font-size: 0.65rem;
    font-weight: 800;
    letter-spacing: 0.08em;
    color: #94a3b8;
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }

  .selected-pill {
    font-family: var(--font-tactical);
    font-size: 0.62rem;
    font-weight: 800;
    color: #eab308;
    background: rgba(234, 179, 8, 0.15);
    padding: 2px 7px;
    border-radius: 4px;
    border: 1px solid rgba(234, 179, 8, 0.4);
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  .obj-description {
    margin: 0;
    font-family: var(--font-display);
    font-size: 0.9rem;
    font-weight: 600;
    line-height: 1.4;
    color: #f1f5f9;
  }

  .obj-footer-meta {
    padding-top: 10px;
    border-top: 1px solid rgba(148, 163, 184, 0.16);
  }

  .doctrine-affinity {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 0.72rem;
    font-weight: 700;
    color: #eab308;
  }

  .doctrine-standard {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 0.72rem;
    color: #64748b;
  }

  /* Footer */
  .toast-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding-top: 10px;
    border-top: 1px solid rgba(148, 163, 184, 0.2);
  }

  .footer-note {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 0.76rem;
    color: #94a3b8;
    line-height: 1.35;
  }

  .confirm-objective-btn {
    height: 44px;
    padding: 0 24px;
    background: linear-gradient(135deg, #eab308 0%, #ca8a04 100%);
    border: 1px solid #fde047;
    border-radius: 6px;
    color: #0f172a;
    font-family: var(--font-display);
    font-weight: 900;
    font-size: 0.88rem;
    letter-spacing: 0.08em;
    display: inline-flex;
    align-items: center;
    gap: 10px;
    cursor: pointer;
    box-shadow: 0 4px 18px rgba(234, 179, 8, 0.35);
    transition: all 0.18s ease;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .confirm-objective-btn:hover:not(:disabled) {
    background: linear-gradient(135deg, #facc15 0%, #d97706 100%);
    transform: translateY(-1px);
    box-shadow: 0 6px 24px rgba(234, 179, 8, 0.5);
  }

  .confirm-objective-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  @keyframes slideDown {
    from {
      opacity: 0;
      transform: translate(-50%, -12px);
    }
    to {
      opacity: 1;
      transform: translate(-50%, 0);
    }
  }

  @media (max-width: 680px) {
    .objective-toast-wrapper {
      top: 74px;
      width: 96vw;
    }
    .objectives-grid {
      grid-template-columns: 1fr;
    }
    .toast-footer {
      flex-direction: column;
      align-items: stretch;
    }
    .confirm-objective-btn {
      width: 100%;
      justify-content: center;
    }
  }
</style>
