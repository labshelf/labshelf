// Shared helpers for the chart editor tests (spec 2.3): a fake animation frame queue, accessible-name lookup of controls, and keyboard helpers.
// Controls are found by their accessible name (aria-label, aria-labelledby, a <label>, or their own text), never by class, so the layout stays the implementation's.

/** A manual requestAnimationFrame: callbacks queue until runFrames() runs them. */
export interface Frames { runFrames(): void; pending(): number; restore(): void }

export function fakeFrames(): Frames {
  const w = window as unknown as { requestAnimationFrame: unknown; cancelAnimationFrame: unknown };
  const realRaf = w.requestAnimationFrame;
  const realCancel = w.cancelAnimationFrame;
  let next = 1;
  const queue = new Map<number, FrameRequestCallback>();
  w.requestAnimationFrame = (cb: FrameRequestCallback): number => { const id = next++; queue.set(id, cb); return id; };
  w.cancelAnimationFrame = (id: number): void => { queue.delete(id); };
  return {
    runFrames(): void {
      const batch = [...queue.entries()];
      queue.clear();
      for (const [, cb] of batch) cb(performance.now());
    },
    pending: () => queue.size,
    restore(): void { w.requestAnimationFrame = realRaf; w.cancelAnimationFrame = realCancel; },
  };
}

/** Lets promises run, runs the queued animation frames, and repeats so a loader that resolves late still gets its frame. */
export async function settle(frames: Frames): Promise<void> {
  for (let n = 0; n < 4; n++) {
    await new Promise<void>((r) => setTimeout(r, 0));
    frames.runFrames();
  }
  await new Promise<void>((r) => setTimeout(r, 0));
}

const CONTROLS = 'button, select, input, textarea, [role="tab"], [role="button"], [role="menuitem"]';

/** The accessible name of a control. */
export function nameOf(el: Element): string {
  const aria = el.getAttribute("aria-label");
  if (aria !== null && aria.trim() !== "") return aria.trim();
  const by = el.getAttribute("aria-labelledby");
  if (by !== null) {
    const text = by.split(/\s+/).map((id) => el.ownerDocument.getElementById(id)?.textContent ?? "").join(" ").trim();
    if (text !== "") return text;
  }
  if (el.id !== "") {
    const label = [...el.ownerDocument.querySelectorAll("label")].find((l) => l.htmlFor === el.id);
    if (label?.textContent?.trim()) return label.textContent.trim();
  }
  const wrapping = el.closest("label");
  if (wrapping?.textContent?.trim() && !(el instanceof HTMLButtonElement)) return wrapping.textContent.trim();
  const title = el.getAttribute("title");
  if (title !== null && title.trim() !== "") return title.trim();
  if (el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) return "";
  if (el instanceof HTMLInputElement) return el.type === "button" || el.type === "submit" ? el.value : "";
  return (el.textContent ?? "").trim();
}

/** False when the element or an ancestor is removed from view by hidden, aria-hidden, inert or display:none. */
export function shown(el: Element): boolean {
  for (let n: Element | null = el; n !== null; n = n.parentElement) {
    if (n.hasAttribute("hidden") || n.getAttribute("aria-hidden") === "true" || n.hasAttribute("inert")) return false;
    if (n instanceof HTMLElement && n.style.display === "none") return false;
  }
  return true;
}

/** Every shown control under `scope` whose accessible name matches, in document order. */
export function controls(scope: ParentNode, name: RegExp): HTMLElement[] {
  return [...scope.querySelectorAll<HTMLElement>(CONTROLS)].filter((el) => shown(el) && name.test(nameOf(el)));
}

/** Every shown control under `scope`, in document order. */
export function allControls(scope: ParentNode): HTMLElement[] {
  return [...scope.querySelectorAll<HTMLElement>(CONTROLS)].filter(shown);
}

export const TYPE = /\btype\b/i;
export const X_COL = /(^|[\s_-])x([\s_-]|$)/i;
export const Y_COL = /(^|[\s_-])y([\s_-]|$)/i;
export const Z_COL = /(^|[\s_-])z([\s_-]|$)/i;
export const TRANSPOSE = /transpose/i;
export const ADD_TRACE = /trace/i;
export const REMOVE = /remove|delete/i;

/** The "+ Trace" button: a button whose name has "trace" and a plus or "add". */
export function addTraceButton(scope: ParentNode): HTMLElement | undefined {
  return controls(scope, /(\+|\badd\b).*trace|trace.*(\+|\badd\b)/i).find((el) => el.tagName === "BUTTON" || el.getAttribute("role") === "button");
}

/** The trace card around a Type control: the largest ancestor holding no other trace's Type control. */
export function cardOf(scope: ParentNode, typeControl: HTMLElement): HTMLElement {
  let card = typeControl;
  while (card.parentElement !== null && scope.contains(card.parentElement) && controls(card.parentElement, TYPE).length === 1) card = card.parentElement;
  return card;
}

/** The trace cards, one per Type control, in order. */
export function cards(scope: ParentNode): HTMLElement[] {
  return controls(scope, TYPE).map((t) => cardOf(scope, t));
}

function fire(el: Element, type: string): void {
  el.dispatchEvent(new Event(type, { bubbles: true }));
}

/** Picks the option of a native select whose value or text names `want` (a column letter or a type name). */
export function chooseOption(select: HTMLSelectElement, want: string): void {
  const lower = want.toLowerCase();
  const options = [...select.options];
  const hit = options.find((o) => o.value.toLowerCase() === lower)
    ?? options.find((o) => o.text.trim().toLowerCase() === lower)
    ?? options.find((o) => o.text.trim().toLowerCase().startsWith(lower + " "))
    ?? options.find((o) => o.text.trim().toLowerCase().startsWith(lower));
  if (hit === undefined) throw new Error(`no option "${want}" in [${options.map((o) => `${o.value}|${o.text}`).join(", ")}]`);
  select.value = hit.value;
  fire(select, "input");
  fire(select, "change");
}

/** Sets a Type or column control: a native select, or a button that opens a menu whose item is clicked. */
export function setChoice(control: HTMLElement, want: string): void {
  if (control instanceof HTMLSelectElement) { chooseOption(control, want); return; }
  control.click();
  const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"], [role="option"], [role="menuitemradio"]')].find((el) => nameOf(el).toLowerCase().startsWith(want.toLowerCase()));
  if (item === undefined) throw new Error(`no menu item "${want}"`);
  item.click();
}

/** Presses a key on an element; returns the event. */
export function press(el: Element, key: string): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  el.dispatchEvent(event);
  return event;
}

/** Activates a nav item the way a keyboard user does: Enter, then the browser's own click for a button the handler left alone. */
export function activate(el: HTMLElement): void {
  const event = press(el, "Enter");
  if (!event.defaultPrevented && el.tagName === "BUTTON") el.click();
}
