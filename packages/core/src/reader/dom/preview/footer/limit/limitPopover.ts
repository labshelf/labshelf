// Builds the popover that edits the page limit, the word limit and where counting stops.
import { el } from "../../../../../ui/dom/index.js";
import type { CheckLimitsChange } from "../../../../index.js";
import type { CountUpTo } from "../../../../../writing/project/index.js";

export interface LimitValues {
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
  const input = el("input", { id, class: "rd-limit-input", type: "text", inputmode: "numeric", placeholder: "none", "aria-label": label, value: value ?? "" });
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { commit(input); } });
  input.addEventListener("blur", () => commit(input));
  return el("div", { class: "rd-limit-row" }, el("label", { for: id }, label), input);
}

/**
 * Builds the popover content for `values`.
 * @param post receives only the fields the reader changed since the content was built or last posted.
 * @param close closes the popover, for Escape.
 */
export function buildLimitPopover(values: LimitValues, post: (limits: CheckLimitsChange) => void, close: () => void): HTMLElement {
  const base = { ...values };
  const commit = (field: "pages" | "words") => (input: HTMLInputElement): void => {
    const parsed = parseLimit(input.value);
    input.setAttribute("aria-invalid", String(parsed === undefined));
    if (parsed === undefined || (parsed ?? undefined) === base[field]) { return; }
    base[field] = parsed ?? undefined;
    post({ [field]: parsed });
  };

  const segment = el("span", { class: "rd-limit-seg", role: "radiogroup", "aria-label": "Count up to" });
  const buttons = UP_TO.map(([value, label]) => {
    const button = el("button", { type: "button", role: "radio", "aria-checked": String(base.countUpTo === value) }, label);
    button.addEventListener("click", () => {
      if (base.countUpTo === value) { return; }
      base.countUpTo = value;
      post({ countUpTo: value });
      buttons.forEach((b, i) => b.setAttribute("aria-checked", String(UP_TO[i]![0] === value)));
    });
    return button;
  });
  segment.append(...buttons);

  const content = el(
    "div", { class: "rd-limit-pop" },
    limitRow("rd-limit-pages", "Page limit", base.pages, commit("pages")),
    limitRow("rd-limit-words", "Word limit", base.words, commit("words")),
    el("div", { class: "rd-limit-row" }, el("span", {}, "Count up to"), segment),
    el("p", {}, "Counts the main text of the shown document and every file it pulls in with \\include or \\input."),
  );
  content.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } });
  return content;
}
