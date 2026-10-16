// Shows body pages and words against the project's limits as a meter, with a popover that edits the limits.
import { el } from "../../../../../ui/dom/index.js";
import type { PreviewRoots, WebviewToHost } from "../../../../index.js";
import { closePopover, togglePopover } from "../../../elements/index.js";
import { buildLimitPopover } from "./limitPopover.js";

interface LimitMeterDeps {
  post: (msg: WebviewToHost) => void;
  countBodyPages: () => Promise<number>;
}

const NEAR = 0.9;

/**
 * Mounts the limit meter into the footer's `limit` slot and reveals the slot.
 * Body pages are counted once per shown PDF and reported with `bodyPages`.
 * @returns `setRoots`, driven by the host's roots messages, and `documentChanged`, for a replaced PDF.
 */
export function mountLimitMeter(slot: HTMLElement, { post, countBodyPages }: LimitMeterDeps): { setRoots(roots: PreviewRoots): void; documentChanged(): void } {
  const fill = el("i");
  const text = el("span", { class: "rd-limit-text" });
  const button = el("button", { class: "rd-limit", type: "button", "aria-haspopup": "dialog", "aria-expanded": "false", title: "Page and word limits" },
    el("span", { class: "rd-limit-meter", "aria-hidden": "true" }, fill), text);
  slot.hidden = false;
  slot.append(button);

  let roots: PreviewRoots | null = null;
  let counted: { root: string; pages: number } | null = null;
  // False from a document change until the shown root is counted again.
  let fresh = false;
  // INVARIANT: only the count started last may report, so a count of a replaced document or root never lands.
  let generation = 0;
  let counting: string | null = null;

  const closeAndFocus = (): void => { closePopover(); button.focus(); };

  button.addEventListener("click", () => {
    if (!roots) { return; }
    const values = { pages: roots.pageLimit, words: roots.wordLimit, countUpTo: roots.countUpTo ?? "references" };
    togglePopover(button, buildLimitPopover(values, (limits) => post({ command: "setCheckLimits", limits }), closeAndFocus), "above");
  });

  function render(): void {
    const shown = roots?.roots.find((r) => r.path === roots?.shown);
    const parts: string[] = [];
    const ratios: number[] = [];
    if (roots?.pageLimit !== undefined && counted?.root === roots.shown) {
      parts.push(`p. ${counted.pages} / ${roots.pageLimit}`);
      ratios.push(counted.pages / roots.pageLimit);
    }
    if (roots?.wordLimit !== undefined && shown?.words !== undefined) {
      parts.push(`${shown.words} words / ${roots.wordLimit}`);
      ratios.push(shown.words / roots.wordLimit);
    }
    const ratio = Math.max(0, ...ratios);
    const state = ratio > 1 ? "over" : ratio >= NEAR ? "near" : "";
    text.textContent = parts.length > 0 ? parts.join(" · ") : "Limits";
    text.dataset["state"] = state;
    fill.className = state;
    fill.style.width = `${Math.min(100, ratio * 100)}%`;
    button.setAttribute("aria-label", parts.length > 0 ? `Limits: ${parts.join(", ")}` : "Limits");
  }

  async function count(root: string): Promise<void> {
    const mine = ++generation;
    counting = root;
    try {
      const pages = await countBodyPages();
      if (mine !== generation) { return; }
      counting = null;
      fresh = true;
      counted = { root, pages };
      post({ command: "bodyPages", root, contentPages: pages });
      refresh();
    } catch (err) {
      if (mine !== generation) { return; }
      counting = null;
      console.warn(`LabShelf reader: could not count the body pages of ${root}`, err);
    }
  }

  function refresh(): void {
    render();
    if (!roots || roots.pageLimit === undefined) { return; }
    if (fresh && counted?.root === roots.shown) { return; }
    if (counting !== roots.shown) { void count(roots.shown); }
  }

  return {
    setRoots(next) { roots = next; refresh(); },
    documentChanged() { fresh = false; generation++; counting = null; refresh(); },
  };
}
