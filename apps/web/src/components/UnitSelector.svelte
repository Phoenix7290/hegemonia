<script lang="ts">
  import { UNIT_TYPES, totalUnits } from "@hegemonia/engine";
  import type { UnitCounts, UnitType } from "@hegemonia/shared";
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

  function adjust(unitType: UnitType, delta: number) {
    const nextValue = selection[unitType] + delta;
    if (nextValue < 0 || nextValue > available[unitType]) return;
    if (delta > 0 && selectedTotal >= maxTotal) return;
    selection = { ...selection, [unitType]: nextValue };
  }
</script>

<div class="unit-selector">
  <div class="unit-selector-head">
    <span>{t("unit_selection_title")}</span>
    <strong>{t("unit_selection_total", { count: selectedTotal, max: maxTotal })}</strong>
  </div>
  <div class="unit-selector-grid">
    {#each UNIT_TYPES as unitType}
      <div class="unit-row" class:unavailable={available[unitType] === 0}>
        <div class="unit-label" title={t(`unit_${unitType}`)}>
          <Icon name={unitType} size={14} />
          <span>{t(`unit_${unitType}`)}</span>
        </div>
        <div class="unit-stepper">
          <button
            type="button"
            aria-label={t("unit_remove", { unit: t(`unit_${unitType}`) })}
            disabled={selection[unitType] === 0}
            onclick={() => adjust(unitType, -1)}
          >
            <Icon name="minus" size={12} />
          </button>
          <strong>{selection[unitType]}</strong>
          <span class="unit-available">/ {available[unitType]}</span>
          <button
            type="button"
            aria-label={t("unit_add", { unit: t(`unit_${unitType}`) })}
            disabled={selection[unitType] >= available[unitType] || selectedTotal >= maxTotal}
            onclick={() => adjust(unitType, 1)}
          >
            <Icon name="plus" size={12} />
          </button>
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
    gap: 0.75rem;
    color: #94a3b8;
    font-size: 0.62rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .unit-selector-head strong {
    color: #fde68a;
    white-space: nowrap;
  }

  .unit-selector-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.25rem 0.5rem;
  }

  .unit-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-width: 0;
    gap: 0.3rem;
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

  .unit-stepper {
    display: flex;
    align-items: center;
    flex-shrink: 0;
    gap: 0.2rem;
    color: #e2e8f0;
    font-size: 0.68rem;
  }

  .unit-stepper button {
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
  }

  .unit-stepper button:hover:not(:disabled) {
    border-color: rgba(234, 179, 8, 0.7);
    color: #fde68a;
  }

  .unit-stepper button:disabled {
    cursor: not-allowed;
    opacity: 0.35;
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
