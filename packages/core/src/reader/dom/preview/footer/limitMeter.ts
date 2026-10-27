// Shows body pages and words against the project's limits as a meter, with a popover that edits the limits.
import { renderElement } from "../../../../ui/dom/index.js";
import type { PreviewBuildRoots, WebviewToHost, CheckLimitsChange } from "../../../index.js";
import { closePopover, updatePopoverOpen } from "../../elements/index.js";
import type { CountUpTo } from "../../../../writing/project/index.js";

interface LimitValues {
  /** The shown root's path; limits are saved per root. */
  file: string;
  pages: number | undefined;
  words: number | undefined;
  countUpTo: CountUpTo;
}

const UP_TO: Array<[CountUpTo, string]> = [["references", "References"], ["end", "End"]];

/** Reads a limit input: empty removes the limit, a positive integer sets it, anything else is undefined. */
function parseLimit(text: string): number | null | undefined {
  const t = text.trim();
  if (t === "") { return null; }
  if (!/^\d+$/.test(t)) { return undefined; }
  const n = Number(t);
  return n > 0 ? n : undefined;
}

function limitRow(id: string, label: string, value: number | undefined, commit: (input: HTMLInputElement) => void): HTMLElement {
  const input = renderElement("input", { id, class: "rd-limit-input", type: "text", inputmode: "numeric", placeholder: "none", "aria-label": label, value: value ?? "" });
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { commit(input); } });
  input.addEventListener("blur", () => commit(input));
  return renderElement("div", { class: "rd-limit-row" }, renderElement("label", { for: id }, label), input);
}

/**
 * Builds the popover content for `values`.
 * @param post receives only the fields the reader changed since the content was built or last posted.
 * @param close closes the popover, for Escape.
 */
function buildLimitPopover(values: LimitValues, post: (limits: CheckLimitsChange) => void, close: () => void): HTMLElement {
  const base = { ...values };
  const commit = (field: "pages" | "words") => (input: HTMLInputElement): void => {
    const parsed = parseLimit(input.value);
    input.setAttribute("aria-invalid", String(parsed === undefined));
    if (parsed === undefined || (parsed ?? undefined) === base[field]) { return; }
    base[field] = parsed ?? undefined;
    post({ [field]: parsed });
  };

  const segment = renderElement("span", { class: "rd-limit-seg", role: "radiogroup", "aria-label": "Count up to" });
  const buttons = UP_TO.map(([value, label]) => {
    const button = renderElement("button", { type: "button", role: "radio", "aria-checked": String(base.countUpTo === value) }, label);
    button.addEventListener("click", () => {
      if (base.countUpTo === value) { return; }
      base.countUpTo = value;
      post({ countUpTo: value });
      buttons.forEach((b, i) => b.setAttribute("aria-checked", String(UP_TO[i]![0] === value)));
    });
    return button;
  });
  segment.append(...buttons);

  const content = renderElement(
    "div", { class: "rd-limit-pop" },
    limitRow("rd-limit-pages", "Page limit", base.pages, commit("pages")),
    limitRow("rd-limit-words", "Word limit", base.words, commit("words")),
    renderElement("div", { class: "rd-limit-row" }, renderElement("span", {}, "Count up to"), segment),
    renderElement("p", {}, "Counts the main text of ", renderElement("code", {}, base.file), " and every file it pulls in with ", renderElement("code", {}, "\\include"), " or ", renderElement("code", {}, "\\input"), `. Saved for ${base.file}.`),
  );
  content.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } });
  return content;
}

interface LimitMeterDeps {
  post: (msg: WebviewToHost) => void;
  countBodyPages: () => Promise<number>;
}

const NEAR = 0.9;

const number = (n: number): string => n.toLocaleString("en-US");

/** `2 / 9 pp` against a limit, `2 pp` without one. */
const figure = (value: number, limit: number | undefined, unit: string): string =>
  limit === undefined ? `${number(value)} ${unit}` : `${number(value)} / ${number(limit)} ${unit}`;

function openLimitPopover(button: HTMLElement, roots: PreviewBuildRoots, post: (msg: WebviewToHost) => void, close: () => void): void {
  const values = { file: roots.shown, pages: roots.pageLimit, words: roots.wordLimit, countUpTo: roots.countUpTo ?? "references" };
  updatePopoverOpen(button, buildLimitPopover(values, (limits) => post({ command: "setCheckLimits", limits }), close), "above");
}

interface MeterView { button: HTMLElement; fill: HTMLElement; text: HTMLElement }

function createMeterView(slot: HTMLElement): MeterView {
  const fill = renderElement("i");
  const text = renderElement("span", { class: "rd-limit-text" });
  const button = renderElement("button", { class: "rd-limit", type: "button", "aria-haspopup": "dialog", "aria-expanded": "false", title: "Page and word limits" },
    renderElement("span", { class: "rd-limit-meter", "aria-hidden": "true" }, fill), text);
  slot.hidden = false;
  slot.append(button);
  return { button, fill, text };
}

function renderMeter({ button, fill, text }: MeterView, roots: PreviewBuildRoots | null, counted: { root: string; pages: number } | null): void {
  const shown = roots?.roots.find((r) => r.path === roots?.shown);
  const parts: string[] = [];
  const ratios: number[] = [];
  if (counted?.root === roots?.shown && counted) {
    parts.push(figure(counted.pages, roots?.pageLimit, "pp"));
    if (roots?.pageLimit !== undefined) { ratios.push(counted.pages / roots.pageLimit); }
  }
  if (shown?.words !== undefined) {
    parts.push(figure(shown.words, roots?.wordLimit, "words"));
    if (roots?.wordLimit !== undefined) { ratios.push(shown.words / roots.wordLimit); }
  }
  const ratio = Math.max(0, ...ratios);
  const state = ratio > 1 ? "over" : ratio >= NEAR ? "near" : "";
  text.textContent = parts.length > 0 ? parts.join(" · ") : "Limits";
  text.dataset["state"] = state;
  fill.className = state;
  fill.style.width = `${Math.min(100, ratio * 100)}%`;
  button.setAttribute("aria-label", parts.length > 0 ? `Limits: ${parts.join(", ")}` : "Limits");
}

/**
 * Mounts the limit meter into the footer's `limit` slot and reveals the slot.
 * Body pages are counted once per shown PDF and reported with `bodyPages`.
 * @returns `setRoots`, driven by the host's roots messages, and `documentChanged`, for a replaced PDF.
 */
export function mountLimitMeter(slot: HTMLElement, { post, countBodyPages }: LimitMeterDeps): { setRoots(roots: PreviewBuildRoots): void; documentChanged(): void } {
  const view = createMeterView(slot);
  const { button } = view;

  let roots: PreviewBuildRoots | null = null;
  let counted: { root: string; pages: number } | null = null;
  // False from a document change until the shown root is counted again.
  let fresh = false;
  // INVARIANT: only the count started last may report, so a count of a replaced document or root never lands.
  let generation = 0;
  let counting: string | null = null;

  const closeAndFocus = (): void => { closePopover(); button.focus(); };

  button.addEventListener("click", () => { if (roots) { openLimitPopover(button, roots, post, closeAndFocus); } });

  const render = (): void => renderMeter(view, roots, counted);

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
    if (!roots) { return; }
    if (fresh && counted?.root === roots.shown) { return; }
    if (counting !== roots.shown) { void count(roots.shown); }
  }

  return {
    setRoots(next) { roots = next; refresh(); },
    documentChanged() { fresh = false; generation++; counting = null; refresh(); },
  };
}
