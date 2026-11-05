<script lang="ts">
  import { UNIT_TYPES, totalUnits } from "@hegemonia/engine";
  import type { UnitCounts, UnitType } from "@hegemonia/shared";
  import { onDestroy } from "svelte";
  import { t } from "../i18n/index.svelte";
  import Icon from "./Icon.svelte";

  let {
    available,
    selection = $bindable(),
    maxTotal,
  }: {
    available: UnitCounts;
    selection: UnitCounts;
    maxTotal: number;
  } = $props();

  let selectedTotal = $derived(totalUnits(selection));

  let isHolding = false;
  let holdTimer: ReturnType<typeof setTimeout> | null = null;
  let handledByPointer = false;

  function stopHold() {
    isHolding = false;
    if (holdTimer !== null) {
      clearTimeout(holdTimer);
      holdTimer = null;
    }
  }

  function adjust(unitType: UnitType, delta: number): boolean {
    const current = selection[unitType] ?? 0;
    const nextValue = current + delta;
    if (nextValue < 0 || nextValue > (available[unitType] ?? 0)) return false;
    if (delta > 0 && selectedTotal >= maxTotal) return false;
    selection = { ...selection, [unitType]: nextValue };
    return true;
  }

  function startHold(e: PointerEvent, unitType: UnitType, delta: number) {
    if (e.button !== 0) return;
    stopHold();
    handledByPointer = true;

    const applied = adjust(unitType, delta);
    if (!applied) return;

    isHolding = true;
    let currentDelay = 320;
    const minDelay = 45;
    const accelerationFactor = 0.82;

    function step() {
      if (!isHolding) return;
      const ok = adjust(unitType, delta);
      if (!ok) {
        stopHold();
        return;
      }
      currentDelay = Math.max(minDelay, Math.floor(currentDelay * accelerationFactor));
      holdTimer = setTimeout(step, currentDelay);
    }

    holdTimer = setTimeout(step, currentDelay);
  }

  function handleClick(e: MouseEvent, unitType: UnitType, delta: number) {
    if (!handledByPointer) {
      adjust(unitType, delta);
    }
    setTimeout(() => {
      handledByPointer = false;
    }, 0);
  }

  function getMaxAllowed(unitType: UnitType): number {
    const current = selection[unitType] ?? 0;
    const otherTotal = selectedTotal - current;
    const remainingBudget = Math.max(0, maxTotal - otherTotal);
    return Math.min(available[unitType] ?? 0, remainingBudget);
  }

  function getTargetHalf(unitType: UnitType): number {
    const maxAllowed = getMaxAllowed(unitType);
    const half = Math.round((available[unitType] ?? 0) * 0.5);
    return Math.min(half, maxAllowed);
  }

  function setCategoryQuick(unitType: UnitType, mode: "zero" | "half" | "max") {
    if (mode === "zero") {
      selection = { ...selection, [unitType]: 0 };
      return;
    }
    if (mode === "half") {
      selection = { ...selection, [unitType]: getTargetHalf(unitType) };
      return;
    }
    if (mode === "max") {
      selection = { ...selection, [unitType]: getMaxAllowed(unitType) };
      return;
    }
  }

  function clearAll() {
    selection = {
      infantry: 0,
      tank: 0,
      artillery: 0,
      aircraft: 0,
      navy: 0,
    };
  }

  function fillMaxAll() {
    let remaining = Math.max(0, maxTotal - selectedTotal);
    if (remaining <= 0) return;
    const next = { ...selection };
    const priorityOrder: UnitType[] = ["tank", "artillery", "infantry", "aircraft", "navy"];
    for (const ut of priorityOrder) {
      if (remaining <= 0) break;
      const canTake = Math.max(0, (available[ut] ?? 0) - (next[ut] ?? 0));
      const take = Math.min(canTake, remaining);
      next[ut] = (next[ut] ?? 0) + take;
      remaining -= take;
    }
    selection = next;
  }

  if (typeof window !== "undefined") {
    window.addEventListener("pointerup", stopHold);
    window.addEventListener("pointercancel", stopHold);
    window.addEventListener("blur", stopHold);
  }

  onDestroy(() => {
    stopHold();
    if (typeof window !== "undefined") {
      window.removeEventListener("pointerup", stopHold);
      window.removeEventListener("pointercancel", stopHold);
      window.removeEventListener("blur", stopHold);
    }
  });
</script>

<div class="unit-selector">
  <div class="unit-selector-head">
    <div class="unit-head-title">
      <span>{t("unit_selection_title")}</span>
      <strong>{t("unit_selection_total", { count: selectedTotal, max: maxTotal })}</strong>
    </div>
    <div class="unit-head-presets">
      <button
        type="button"
        class="head-preset-btn"
        disabled={selectedTotal === 0}
        onclick={clearAll}
        title={t("unit_preset_clear_all_tip")}
      >
        {t("unit_preset_zero")}
      </button>
      <button
        type="button"
        class="head-preset-btn primary"
        disabled={selectedTotal >= maxTotal || maxTotal <= 0}
        onclick={fillMaxAll}
        title={t("unit_preset_fill_max_tip")}
      >
        {t("unit_preset_max")}
      </button>
    </div>
  </div>

  <div class="unit-selector-grid">
    {#each UNIT_TYPES as unitType}
      {@const maxAllowed = getMaxAllowed(unitType)}
      {@const targetHalf = getTargetHalf(unitType)}
      {@const hasUnits = (available[unitType] ?? 0) > 0}
      <div class="unit-row" class:unavailable={!hasUnits}>
        <div class="unit-label" title={t(`unit_${unitType}`)}>
          <Icon name={unitType} size={14} />
          <span>{t(`unit_${unitType}`)}</span>
        </div>

        <div class="unit-controls">
          <div class="category-presets" role="group" aria-label="{t(`unit_${unitType}`)} presets">
            <button
              type="button"
              class="preset-chip"
              class:active={hasUnits && selection[unitType] === 0}
              disabled={!hasUnits || selection[unitType] === 0}
              onclick={() => setCategoryQuick(unitType, "zero")}
              title="{t('unit_preset_zero_category', { unit: t(`unit_${unitType}`) })}"
            >
              0
            </button>
            <button
              type="button"
              class="preset-chip"
              class:active={hasUnits && (available[unitType] ?? 0) >= 2 && targetHalf > 0 && selection[unitType] === targetHalf}
              disabled={!hasUnits || (available[unitType] ?? 0) < 2 || targetHalf <= 0 || selection[unitType] === targetHalf}
              onclick={() => setCategoryQuick(unitType, "half")}
              title="{t('unit_preset_half_category', { unit: t(`unit_${unitType}`) })}"
            >
              50%
            </button>
            <button
              type="button"
              class="preset-chip"
              class:active={hasUnits && maxAllowed > 0 && selection[unitType] === maxAllowed}
              disabled={!hasUnits || maxAllowed <= 0 || selection[unitType] === maxAllowed}
              onclick={() => setCategoryQuick(unitType, "max")}
              title="{t('unit_preset_max_category', { unit: t(`unit_${unitType}`) })}"
            >
              Max
            </button>
          </div>

          <div class="unit-stepper">
            <button
              type="button"
              class="stepper-btn"
              aria-label={t("unit_remove", { unit: t(`unit_${unitType}`) })}
              disabled={selection[unitType] === 0}
              onpointerdown={(e) => startHold(e, unitType, -1)}
              onpointerup={stopHold}
              onpointerleave={stopHold}
              onpointercancel={stopHold}
              onclick={(e) => handleClick(e, unitType, -1)}
              oncontextmenu={(e) => e.preventDefault()}
            >
              <Icon name="minus" size={12} />
            </button>
            <span class="stepper-count">
              <strong>{selection[unitType]}</strong>
              <span class="unit-available">/{available[unitType] ?? 0}</span>
            </span>
            <button
              type="button"
              class="stepper-btn"
              aria-label={t("unit_add", { unit: t(`unit_${unitType}`) })}
              disabled={(selection[unitType] ?? 0) >= (available[unitType] ?? 0) || selectedTotal >= maxTotal}
              onpointerdown={(e) => startHold(e, unitType, 1)}
              onpointerup={stopHold}
              onpointerleave={stopHold}
              onpointercancel={stopHold}
              onclick={(e) => handleClick(e, unitType, 1)}
              oncontextmenu={(e) => e.preventDefault()}
            >
              <Icon name="plus" size={12} />
            </button>
          </div>
        </div>
      </div>
    {/each}
  </div>
</div>

<style>
  .unit-selector {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    margin: 0.5rem 0;
    padding: 0.45rem;
    border: 1px solid rgba(148, 163, 184, 0.2);
    border-radius: 5px;
    background: rgba(15, 23, 42, 0.62);
  }

  .unit-selector-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.5rem;
    color: #94a3b8;
    font-size: 0.62rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .unit-head-title {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    min-width: 0;
  }

  .unit-head-title strong {
    color: #fde68a;
    white-space: nowrap;
    font-family: var(--font-mono, monospace);
  }

  .unit-head-presets {
    display: flex;
    align-items: center;
    gap: 0.3rem;
  }

  .head-preset-btn {
    padding: 0.12rem 0.42rem;
    font-size: 0.58rem;
    font-family: var(--font-tactical, sans-serif);
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    border: 1px solid rgba(148, 163, 184, 0.3);
    border-radius: 3px;
    background: rgba(30, 41, 59, 0.85);
    color: #cbd5e1;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .head-preset-btn:hover:not(:disabled) {
    border-color: rgba(234, 179, 8, 0.6);
    color: #fde68a;
  }

  .head-preset-btn.primary {
    border-color: rgba(234, 179, 8, 0.45);
    color: #fde68a;
    background: rgba(234, 179, 8, 0.15);
  }

  .head-preset-btn.primary:hover:not(:disabled) {
    background: rgba(234, 179, 8, 0.3);
  }

  .head-preset-btn:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  .unit-selector-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.3rem 0.6rem;
  }

  .unit-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-width: 0;
    gap: 0.3rem;
    padding: 0.1rem 0;
  }

  .unit-row.unavailable {
    opacity: 0.4;
  }

  .unit-label {
    display: flex;
    align-items: center;
    min-width: 0;
    gap: 0.3rem;
    color: #cbd5e1;
    font-size: 0.65rem;
  }

  .unit-label span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .unit-controls {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    flex-shrink: 0;
  }

  .category-presets {
    display: inline-flex;
    align-items: center;
    background: rgba(15, 23, 42, 0.85);
    border: 1px solid rgba(148, 163, 184, 0.25);
    border-radius: 3px;
    padding: 1px;
    gap: 1px;
  }

  .preset-chip {
    padding: 0.12rem 0.32rem;
    font-size: 0.58rem;
    font-family: var(--font-mono, monospace);
    font-weight: 700;
    line-height: 1;
    border: none;
    border-radius: 2px;
    background: transparent;
    color: #94a3b8;
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
    user-select: none;
  }

  .preset-chip:hover:not(:disabled) {
    background: rgba(51, 65, 85, 0.8);
    color: #f8fafc;
  }

  .preset-chip.active {
    background: rgba(234, 179, 8, 0.25);
    color: #fde68a;
  }

  .preset-chip:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  .unit-stepper {
    display: flex;
    align-items: center;
    flex-shrink: 0;
    gap: 0.2rem;
    color: #e2e8f0;
    font-size: 0.68rem;
  }

  .stepper-btn {
    display: grid;
    place-items: center;
    width: 1.35rem;
    height: 1.35rem;
    padding: 0;
    border: 1px solid rgba(148, 163, 184, 0.3);
    border-radius: 3px;
    background: rgba(30, 41, 59, 0.8);
    color: #e2e8f0;
    cursor: pointer;
    touch-action: manipulation;
    user-select: none;
    transition: border-color 0.15s, color 0.15s;
  }

  .stepper-btn:hover:not(:disabled) {
    border-color: rgba(234, 179, 8, 0.7);
    color: #fde68a;
  }

  .stepper-btn:disabled {
    cursor: not-allowed;
    opacity: 0.35;
  }

  .stepper-count {
    display: inline-flex;
    align-items: baseline;
    justify-content: center;
    gap: 0.08rem;
    min-width: 1.9rem;
    font-family: var(--font-mono, monospace);
  }

  .unit-available {
    color: #64748b;
    font-size: 0.58rem;
  }

  @media (max-width: 900px) {
    .unit-selector-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
