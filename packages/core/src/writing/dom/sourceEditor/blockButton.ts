// The floating button over a block of the source text (Edit figure, Chart, Open source): placed at the top right of the hovered
// block, or the one holding the cursor while the editor has the focus, and moved again when the layout changes.
import type { Extension } from "@codemirror/state";
import { ViewPlugin, type EditorView, type ViewUpdate } from "@codemirror/view";
import { renderElement } from "../../../ui/dom/index.js";
import { renderIcon, type IconName } from "../../../ui/icons/index.js";

const EDGE = 4;

/** A block of the text, from its first line's start to its last line's end. */
export interface BlockSpan { from: number; to: number }

/** The box of a block of the text, from its first line to its last, across the text column; null when it is not laid out. */
export function blockBox(view: EditorView, span: BlockSpan): DOMRect | null {
  const top = view.coordsAtPos(span.from, 1);
  const bottom = view.coordsAtPos(span.to, -1);
  if (!top || !bottom) return null;
  const column = view.contentDOM.getBoundingClientRect();
  return new DOMRect(column.left, top.top, column.width, bottom.bottom - top.top);
}

/** The block a button is over: the hovered one, else the one holding the cursor while the editor has the focus; none in a read-only editor unless `readOnly` allows it. */
export function activeBlock<T>(view: EditorView, hovered: T | null, at: (pos: number) => T | null, readOnly = false): T | null {
  if (view.state.readOnly && !readOnly) return null;
  return hovered ?? (view.hasFocus ? at(view.state.selection.main.head) : null);
}

/** Places a block's button again after an update that can move it, reading the layout in the measure phase, not during the update. */
export function remeasure<T>(update: ViewUpdate, key: object, read: () => T, write: (value: T) => void): void {
  if (update.docChanged || update.selectionSet || update.focusChanged || update.geometryChanged || update.viewportChanged) update.view.requestMeasure({ key, read, write });
}

export interface BlockButtonOptions<T extends BlockSpan> {
  /** The button's class, which the stylesheet places and draws. */
  className: string;
  label: string;
  title: string;
  icon: IconName;
  /** The blocks of the text the button can stand over. */
  spans(text: string): T[];
  /** Runs on a click, on the block the button stood over. */
  run(view: EditorView, span: T): void;
  /** Shows the button in a read-only editor too, for an action that does not edit. */
  readOnly?: boolean;
}

/** The plugin behind `blockButton`: one floating button per editor. */
class BlockButtonView<T extends BlockSpan> {
  private spans: T[];
  private hovered: T | null = null;
  private readonly button: HTMLButtonElement;
  private readonly onMove = (event: MouseEvent): void => {
    const pos = this.view.posAtCoords({ x: event.clientX, y: event.clientY });
    const next = pos === null ? null : this.spanAt(pos);
    if (next !== this.hovered) { this.hovered = next; this.place(this.target()); }
  };
  private readonly onLeave = (event: MouseEvent): void => {
    if (event.relatedTarget === this.button) return;
    this.hovered = null;
    this.place(null);
  };
  private readonly onScroll = (): void => this.place(this.target());

  constructor(private readonly view: EditorView, private readonly options: BlockButtonOptions<T>) {
    this.spans = this.options.spans(view.state.doc.toString());
    this.button = renderElement("button", { type: "button", class: this.options.className, title: this.options.title, html: `${renderIcon(this.options.icon)}<span>${this.options.label}</span>` }) as HTMLButtonElement;
    this.button.hidden = true;
    const root = view.dom.getRootNode();
    (root instanceof ShadowRoot ? root : document.body).append(this.button);
    // The editor keeps its focus and selection when the button is pressed.
    this.button.addEventListener("mousedown", (event) => event.preventDefault());
    this.button.addEventListener("click", () => {
      const span = this.active();
      this.hovered = null;
      this.place(null);
      if (span) this.options.run(view, span);
    });
    this.button.addEventListener("mouseleave", (event) => { if (!view.dom.contains(event.relatedTarget as Node | null)) { this.hovered = null; this.place(null); } });
    view.dom.addEventListener("mousemove", this.onMove);
    view.dom.addEventListener("mouseleave", this.onLeave);
    window.addEventListener("scroll", this.onScroll, true);
    window.addEventListener("resize", this.onScroll);
  }

  private spanAt(pos: number): T | null {
    return this.spans.find((s) => pos >= s.from && pos <= s.to) ?? null;
  }

  private active(): T | null {
    return activeBlock(this.view, this.hovered, (pos) => this.spanAt(pos), this.options.readOnly);
  }

  private target(): DOMRect | null {
    const span = this.active();
    return span && blockBox(this.view, span);
  }

  private place(rect: DOMRect | null): void {
    const visible = rect !== null && rect.bottom > 0 && rect.top < window.innerHeight;
    this.button.hidden = !visible;
    if (!visible) return;
    this.button.style.top = `${Math.max(EDGE, rect.top + EDGE)}px`;
    this.button.style.left = `${rect.right - 8 - this.button.offsetWidth - EDGE}px`;
  }

  update(update: ViewUpdate): void {
    if (update.docChanged) { this.spans = this.options.spans(update.state.doc.toString()); this.hovered = null; }
    remeasure(update, this, () => this.target(), (rect) => this.place(rect));
  }

  destroy(): void {
    this.view.dom.removeEventListener("mousemove", this.onMove);
    this.view.dom.removeEventListener("mouseleave", this.onLeave);
    window.removeEventListener("scroll", this.onScroll, true);
    window.removeEventListener("resize", this.onScroll);
    this.button.remove();
  }
}

/** A button over the hovered block, or the one holding the cursor while the editor has the focus. */
export function blockButton<T extends BlockSpan>(options: BlockButtonOptions<T>): Extension {
  return ViewPlugin.define((view) => new BlockButtonView(view, options));
}
