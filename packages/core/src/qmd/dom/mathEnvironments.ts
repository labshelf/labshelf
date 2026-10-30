// LaTeX environments in the equation editor: the names offered after `\begin{`, the closing `\end{…}` added once a
// `\begin{name}` is complete, and LaTeX's display environments (align, gather, equation) swapped for the ones that work
// inside `$$` in every Quarto output.
import { renderElement } from "../../ui/dom/index.js";

/** The environments offered after `\begin{`, most used first. */
const MATH_ENVIRONMENTS = ["aligned", "cases", "pmatrix", "bmatrix", "matrix", "vmatrix", "gathered", "split", "array", "alignedat", "Bmatrix", "Vmatrix", "smallmatrix"];

/**
 * LaTeX's display environments, which stand on their own and break a Quarto PDF inside `$$`, and what takes their place
 * inside `$$`: the inner environment with the same layout, or "" for one that only frames a single equation.
 */
const INSIDE_DOLLARS: Record<string, string> = {
  align: "aligned", "align*": "aligned", eqnarray: "aligned", "eqnarray*": "aligned", flalign: "aligned", "flalign*": "aligned",
  gather: "gathered", "gather*": "gathered", equation: "", "equation*": "", displaymath: "",
};

/** What `\begin{name}` becomes inside `$$`: the name itself, the counterpart of a display environment, or "" for none. */
export function environmentInsideDollars(name: string): string {
  return INSIDE_DOLLARS[name] ?? name;
}

/** The TeX of an empty `name` environment, on three lines with an empty one in the middle or on one line; "" for no name. */
export function emptyEnvironment(name: string, multiline: boolean): string {
  if (!name) return "";
  return multiline ? `\\begin{${name}}\n\n\\end{${name}}` : `\\begin{${name}}  \\end{${name}}`;
}

/** Where the caret goes in TeX that is only an empty environment: its empty line, or between its two spaces; null for other TeX. */
export function emptyEnvironmentCaret(tex: string): number | null {
  const match = /^\\begin\{([A-Za-z]+\*?)\}(?:\n\n| {2})\\end\{\1\}$/.exec(tex);
  return match ? `\\begin{${match[1]}}`.length + 1 : null;
}

const count = (text: string, part: string): number => text.split(part).length - 1;

/**
 * Completes a `\begin{name}` just typed before the caret: a display environment becomes its `$$` counterpart and an
 * environment not yet closed gets its `\end{…}`, the caret left inside it.
 */
function closeEnvironment(input: HTMLInputElement | HTMLTextAreaElement): void {
  const at = input.selectionStart ?? 0;
  if (at !== input.selectionEnd) return;
  const match = /\\begin\{([A-Za-z]+\*?)\}$/.exec(input.value.slice(0, at));
  if (!match) return;
  const typed = match[1] as string;
  if (count(input.value, `\\end{${typed}}`) >= count(input.value, `\\begin{${typed}}`)) return;
  const tex = emptyEnvironment(environmentInsideDollars(typed), input instanceof HTMLTextAreaElement);
  const start = at - match[0].length;
  input.setRangeText(tex, start, at);
  const caret = start + (emptyEnvironmentCaret(tex) ?? 0);
  input.setSelectionRange(caret, caret);
}

/**
 * Adds environment help to an equation's LaTeX field: a list of names while `\begin{` is being typed (arrows move, Tab
 * or Enter picks, Esc hides it) and the completion of a finished `\begin{name}`. Attach it before the field's own
 * `input` and `keydown` handlers, which then see the completed text and none of the keys the list used.
 * @returns the list, to place in the field's panel.
 */
export function attachEnvironmentHelp(input: HTMLInputElement | HTMLTextAreaElement): HTMLElement {
  const list = renderElement("span", { class: "qmd-math-suggest", role: "listbox", "aria-label": "LaTeX environments", hidden: true });
  let names: string[] = [];
  let active = 0;
  let dismissed = false;

  const typedName = (): string | null => /\\begin\{([A-Za-z]*)$/.exec(input.value.slice(0, input.selectionStart ?? 0))?.[1] ?? null;
  const render = (): void => {
    list.hidden = names.length === 0;
    list.replaceChildren(...names.map((name, index) => {
      const item = renderElement("span", { class: "qmd-math-suggest-item", role: "option", "aria-selected": String(index === active), text: name });
      // Keeps the focus in the field so picking does not end the edit.
      item.addEventListener("mousedown", (event) => { event.preventDefault(); pick(name); });
      return item;
    }));
  };
  const refresh = (): void => {
    const typed = dismissed || input.selectionStart !== input.selectionEnd ? null : typedName();
    names = typed === null ? [] : MATH_ENVIRONMENTS.filter((name) => name.startsWith(typed) && name !== typed);
    active = Math.min(active, Math.max(0, names.length - 1));
    render();
  };
  const pick = (name: string): void => {
    const at = input.selectionStart ?? 0;
    input.setRangeText(`${name}}`, at - (typedName() ?? "").length, at, "end");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };

  input.addEventListener("input", () => {
    dismissed = false;
    if (input.value[(input.selectionStart ?? 0) - 1] === "}") closeEnvironment(input);
    refresh();
  });
  input.addEventListener("keydown", (raw) => {
    const event = raw as KeyboardEvent;
    if (list.hidden || event.isComposing) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") active = (active + (event.key === "ArrowDown" ? 1 : names.length - 1)) % names.length;
    else if (event.key === "Tab" || event.key === "Enter") pick(names[active] as string);
    else if (event.key === "Escape") dismissed = true;
    else return;
    event.preventDefault();
    event.stopImmediatePropagation();
    refresh();
  });
  input.addEventListener("keyup", (raw) => { if (/^(?:Arrow(?:Left|Right)|Home|End)$/.test((raw as KeyboardEvent).key)) refresh(); });
  input.addEventListener("blur", () => { names = []; render(); });
  return list;
}
