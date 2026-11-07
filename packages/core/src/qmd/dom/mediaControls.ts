// The layout controls of an image, a figure or a LaTeX table in an editable editor: a width field (10 to 100, the
// percentage of the text column) and three alignment buttons, at the top right of the item's full-width row so they stay
// put whatever width or alignment the item takes. Typing or stepping the width previews it live; Enter, a step or leaving
// the field commits it once; Escape puts the saved width back. A button commits its alignment at once.
import { renderElement } from "../../ui/dom/index.js";
import { renderIcon } from "../../ui/icons/index.js";
import { cssWidth, type MediaAlign } from "../editor/index.js";

/** What an item gives its controls: the saved width and alignment, the live preview and the one commit (a null width is full width). */
export interface MediaTarget {
  width(): string | null;
  align(): MediaAlign;
  preview(width: string | null, align: MediaAlign): void;
  commit(width: string | null, align: MediaAlign): void;
}

/** The mounted controls: their element, a re-read of the saved values, and whether an event is theirs (for the node view's stopEvent). */
export interface MediaControls {
  readonly el: HTMLElement;
  sync(): void;
  isControlEvent(event: Event): boolean;
}

/** Shows `width` and `align` on `box`: a CSS width in `--qmd-media-width` with the `has-width` class (an unreadable or null width shows the natural size) and `data-align`. */
export function showMediaLayout(box: HTMLElement, width: string | null, align: MediaAlign): void {
  const css = cssWidth(width);
  box.classList.toggle("has-width", css !== null);
  if (css === null) box.style.removeProperty("--qmd-media-width");
  else box.style.setProperty("--qmd-media-width", css);
  box.dataset.align = align;
}

const MIN = 10;
const MAX = 100;
const ALIGNS: ReadonlyArray<{ align: MediaAlign; title: string; icon: "align-left" | "align-center" | "align-right" }> = [
  { align: "left", title: "Align left", icon: "align-left" },
  { align: "center", title: "Align center", icon: "align-center" },
  { align: "right", title: "Align right", icon: "align-right" },
];

/** The percentage a saved width shows: 100 without one, its number for a percentage, empty for another unit. */
function percentOf(width: string | null): string {
  if (width === null) return String(MAX);
  const match = /^(\d+(?:\.\d+)?)%$/.exec(width);
  return match ? match[1]! : "";
}

/** The width a typed value gives (null is full width; 10 is the floor, so the item never vanishes), or undefined while it is not a number. */
function widthOf(value: string): string | null | undefined {
  const number = Number(value);
  if (value.trim() === "" || !Number.isFinite(number)) return undefined;
  const percent = Math.min(MAX, Math.max(MIN, Math.round(number)));
  return percent === MAX ? null : `${percent}%`;
}

/** Puts the controls at the end of `host`, the item's full-width row (which must be positioned), and returns them. */
export function mountMediaControls(host: HTMLElement, target: MediaTarget): MediaControls {
  const input = renderElement("input", { class: "qmd-width-input", type: "number", min: String(MIN), max: String(MAX), step: "5", "aria-label": "Width, percent of the column" }) as HTMLInputElement;
  const field = renderElement("label", { class: "qmd-width-field", title: "Width (% of the column)" }, input, renderElement("span", { text: "%" }));
  const buttons = ALIGNS.map(({ align, title, icon }) => {
    const button = renderElement("button", { type: "button", class: "qmd-media-align", title, "aria-label": title, "aria-pressed": "false", html: renderIcon(icon) });
    button.addEventListener("click", () => { if (align !== target.align()) target.commit(target.width(), align); });
    return { align, button };
  });
  const el = renderElement("span", { class: "qmd-media-controls", contenteditable: "false" }, field, ...buttons.map(({ button }) => button));
  let editing = false;

  const sync = (): void => {
    if (!editing) input.value = percentOf(target.width());
    const current = target.align();
    for (const { align, button } of buttons) button.setAttribute("aria-pressed", String(align === current));
  };
  const commit = (): void => {
    editing = false;
    const width = widthOf(input.value);
    if (width !== undefined && width !== target.width()) target.commit(width, target.align());
    else target.preview(target.width(), target.align());
    sync();
  };

  input.addEventListener("focus", () => { editing = true; });
  input.addEventListener("input", () => {
    editing = true;
    const width = widthOf(input.value);
    if (width !== undefined) target.preview(width, target.align());
  });
  input.addEventListener("change", commit);
  input.addEventListener("blur", () => { if (editing) commit(); });
  input.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Enter") { event.preventDefault(); input.blur(); }
    if (event.key === "Escape") {
      event.preventDefault();
      editing = false;
      target.preview(target.width(), target.align());
      sync();
      input.blur();
    }
  });
  // A press or click on the controls must not open the item's editor, select the node or open a table's source.
  for (const type of ["click", "pointerdown", "mousedown", "dblclick"]) el.addEventListener(type, (event) => event.stopPropagation());
  host.append(el);
  sync();
  return { el, sync, isControlEvent: (event) => el.contains(event.target as Node) };
}
