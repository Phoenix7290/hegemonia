import { ui } from "./ui.svelte";

export interface TooltipOptions {
  text: string;
  subtext?: string;
  delay?: number;
}

export type TooltipParam = string | TooltipOptions;

/**
 * Tactical Tooltip Directive (HEGEM-103)
 * Provides a delayed contextual tooltip on continuous pointer hover.
 */
export function tooltip(node: HTMLElement, param: TooltipParam) {
  let timer: ReturnType<typeof setTimeout> | null = null;

  function handlePointerEnter() {
    if (!ui.tooltipsEnabled) return;
    const text = typeof param === "string" ? param : param.text;
    const subtext = typeof param === "string" ? undefined : param.subtext;
    const delay = (typeof param === "object" ? param.delay : undefined) ?? 350;

    if (!text) return;

    timer = setTimeout(() => {
      const rect = node.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top;
      ui.showTooltip(text, x, y, subtext);
    }, delay);
  }

  function handlePointerLeave() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    ui.hideTooltip();
  }

  node.addEventListener("pointerenter", handlePointerEnter);
  node.addEventListener("pointerleave", handlePointerLeave);
  node.addEventListener("pointerdown", handlePointerLeave);

  return {
    update(newParam: TooltipParam) {
      param = newParam;
    },
    destroy() {
      if (timer) clearTimeout(timer);
      node.removeEventListener("pointerenter", handlePointerEnter);
      node.removeEventListener("pointerleave", handlePointerLeave);
      node.removeEventListener("pointerdown", handlePointerLeave);
    },
  };
}
