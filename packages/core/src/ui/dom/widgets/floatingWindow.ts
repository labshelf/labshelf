// Non-modal floating windows: a card with a head (icon, title, Open, close), a body the host fills and a corner grip. The user drags it by the head, sizes it by
// the grip or the arrow keys, and clicking or focusing inside raises it above the others of its manager; Escape inside closes it. No scrim, no focus trap.
import { renderIcon, type IconName } from "../../icons/index.js";
import { renderElement } from "../dom.js";

const MIN_WIDTH = 320;
const MIN_HEIGHT = 220;
const MAX_WIDTH_SHARE = 0.95;
const MAX_HEIGHT_SHARE = 0.9;
const DEFAULT_WIDTH = 520;
const DEFAULT_HEIGHT = 420;
const RESIZE_STEP = 16;
const RESIZE_STEP_SHIFT = 64;
const CASCADE = 24;
const DEFAULT_MAX_OPEN = 4;
/** Floating windows stack from here, below the modal dialogs (1001) and their scrim (900). */
const Z_BASE = 800;

interface Size { width: number; height: number }
interface Box extends Size { left: number; top: number }

/** The size the user gave each kind of window, so the next one of that kind opens at it (kept while the page lives, across managers). */
const sizes = new Map<string, Size>();
let windowCount = 0;

export interface FloatingWindowSpec {
  /** Keys the remembered size. */
  kind: string;
  title: string;
  /** An icon name of the core icon set, shown before the title. */
  icon?: string;
  /** Adds an Open button to the head that calls it. */
  onOpen?: () => void;
  /** Runs when the window closes (a host flush); the window is removed once it settles, even when it throws. */
  onClose?: () => void | Promise<void>;
}

export interface FloatingWindow {
  readonly id: string;
  readonly kind: string;
  readonly element: HTMLElement;
  /** The area the host fills. */
  readonly body: HTMLElement;
  /** The head's title; setting it also names the dialog. */
  title: string;
  raise(): void;
  /** Puts the window back inside the viewport and raises it. */
  bringIntoView(): void;
  close(): Promise<void>;
  readonly closed: boolean;
}

export interface FloatingWindows {
  open(spec: FloatingWindowSpec): FloatingWindow;
  /** The open windows, in open order. */
  list(): readonly FloatingWindow[];
  /** Calls `listener` after a window opens, closes or changes its title; returns the unsubscribe. */
  onChange(listener: () => void): () => void;
  closeAll(): Promise<void>;
}

interface Entry { win: FloatingWindow; box: Box; closing: boolean }

function clamp(value: number, min: number, max: number): number { return Math.min(max, Math.max(min, value)); }

function limits(): { maxWidth: number; maxHeight: number } {
  return {
    maxWidth: Math.max(MIN_WIDTH, Math.floor(window.innerWidth * MAX_WIDTH_SHARE)),
    maxHeight: Math.max(MIN_HEIGHT, Math.floor(window.innerHeight * MAX_HEIGHT_SHARE)),
  };
}

function clampSize(width: number, height: number): Size {
  const { maxWidth, maxHeight } = limits();
  return { width: clamp(width, MIN_WIDTH, maxWidth), height: clamp(height, MIN_HEIGHT, maxHeight) };
}

/** `box` moved so it lies inside the viewport. */
function clampPosition(box: Box): Box {
  return {
    ...box,
    left: clamp(box.left, 0, Math.max(0, window.innerWidth - box.width)),
    top: clamp(box.top, 0, Math.max(0, window.innerHeight - box.height)),
  };
}

/** Creates a manager of floating windows; each is mounted in `root` (the page body by default), at most `max` (4) open at once. */
export function createFloatingWindows(options?: { root?: HTMLElement; max?: number }): FloatingWindows {
  const max = Math.max(1, options?.max ?? DEFAULT_MAX_OPEN);
  const entries: Entry[] = [];
  /** Back to front. */
  const stack: Entry[] = [];
  const listeners = new Set<() => void>();
  let lastOpened: Entry | null = null;

  const notify = (): void => { for (const listener of [...listeners]) listener(); };

  const restack = (): void => {
    stack.forEach((entry, index) => {
      entry.win.element.style.zIndex = String(Z_BASE + index);
      entry.win.element.classList.toggle("is-front", index === stack.length - 1);
    });
  };
  const raise = (entry: Entry): void => {
    const at = stack.indexOf(entry);
    if (at === stack.length - 1) return;
    if (at >= 0) stack.splice(at, 1);
    stack.push(entry);
    restack();
  };

  const apply = (entry: Entry, box: Box): void => {
    entry.box = box;
    const style = entry.win.element.style;
    style.left = `${box.left}px`;
    style.top = `${box.top}px`;
    style.width = `${box.width}px`;
    style.height = `${box.height}px`;
  };
  const moveTo = (entry: Entry, left: number, top: number): void => apply(entry, clampPosition({ ...entry.box, left, top }));
  const resizeTo = (entry: Entry, width: number, height: number, kind: string): void => {
    const size = clampSize(width, height);
    sizes.set(kind, size);
    apply(entry, clampPosition({ ...entry.box, ...size }));
  };
  const refit = (entry: Entry): void => apply(entry, clampPosition({ ...entry.box, ...clampSize(entry.box.width, entry.box.height) }));

  function open(spec: FloatingWindowSpec): FloatingWindow {
    const id = `ls-floating-window-${++windowCount}`;
    let title = spec.title;
    const titleEl = renderElement("span", { class: "ls-floating-window-title", text: title });
    const head = renderElement("header", { class: "ls-floating-window-head" },
      spec.icon ? renderElement("span", { class: "ls-floating-window-icon", "aria-hidden": "true", html: renderIcon(spec.icon as IconName) }) : null,
      titleEl);
    const openButton = spec.onOpen ? headButton("Open", "external") : null;
    const closeButton = headButton("Close", "x");
    const actions = renderElement("div", { class: "ls-floating-window-actions" }, openButton, closeButton);
    head.append(actions);
    const body = renderElement("div", { class: "ls-floating-window-body" });
    const element = renderElement("section", { class: "ls-floating-window", id, role: "dialog", "aria-label": title }, head, body);

    let closePromise: Promise<void> | null = null;
    let closed = false;
    const win: FloatingWindow = {
      id, kind: spec.kind, element, body,
      get title() { return title; },
      set title(value: string) {
        title = value;
        titleEl.textContent = value;
        element.setAttribute("aria-label", value);
        notify();
      },
      raise: () => raise(entry),
      bringIntoView: () => { refit(entry); raise(entry); },
      close: () => {
        closePromise ??= (async () => {
          entry.closing = true;
          try { await spec.onClose?.(); } catch { /* the host's flush failed: the window still closes */ }
          closed = true;
          window.removeEventListener("resize", onViewportResize);
          element.remove();
          for (const list of [entries, stack]) { const at = list.indexOf(entry); if (at >= 0) list.splice(at, 1); }
          if (lastOpened === entry) lastOpened = entries.at(-1) ?? null;
          notify();
        })();
        return closePromise;
      },
      get closed() { return closed; },
    };
    const entry: Entry = { win, box: place(spec.kind), closing: false };
    const onViewportResize = (): void => refit(entry);

    openButton?.addEventListener("click", () => spec.onOpen?.());
    closeButton.addEventListener("click", () => { void win.close(); });
    element.addEventListener("pointerdown", () => raise(entry));
    element.addEventListener("focusin", () => raise(entry));
    element.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      void win.close();
    });
    attachMove(head, entry);
    element.append(renderGrip(entry, spec.kind));
    window.addEventListener("resize", onViewportResize);

    apply(entry, entry.box);
    (options?.root ?? document.body).append(element);
    entries.push(entry);
    stack.push(entry);
    restack();
    lastOpened = entry;
    notify();
    // Past the cap the oldest by open order goes; the one just opened is never the one.
    const live = entries.filter((candidate) => !candidate.closing);
    for (let i = 0; live.length - i > max; i += 1) void live[i]!.win.close();
    return win;
  }

  /** The first window opens centred; each next one 24px right and down from the last opened. */
  function place(kind: string): Box {
    const size = clampSize(sizes.get(kind)?.width ?? DEFAULT_WIDTH, sizes.get(kind)?.height ?? DEFAULT_HEIGHT);
    const from = lastOpened?.box ?? null;
    if (!from) return clampPosition({ ...size, left: (window.innerWidth - size.width) / 2, top: (window.innerHeight - size.height) / 2 });
    return clampPosition({ ...size, left: from.left + CASCADE, top: from.top + CASCADE });
  }

  /** Dragging the head (not its buttons) moves the window; it stays inside the viewport. */
  function attachMove(head: HTMLElement, entry: Entry): void {
    head.addEventListener("pointerdown", (event) => {
      if ((event.target as Element | null)?.closest("button")) return;
      if (event.button !== undefined && event.button !== 0) return;
      event.preventDefault();
      const start = { x: event.clientX, y: event.clientY, left: entry.box.left, top: entry.box.top };
      head.setPointerCapture?.(event.pointerId);
      const move = (next: PointerEvent): void => moveTo(entry, start.left + next.clientX - start.x, start.top + next.clientY - start.y);
      const end = (): void => {
        head.removeEventListener("pointermove", move);
        head.removeEventListener("pointerup", end);
        head.removeEventListener("pointercancel", end);
      };
      head.addEventListener("pointermove", move);
      head.addEventListener("pointerup", end);
      head.addEventListener("pointercancel", end);
    });
  }

  /** The corner grip: dragging it, or the arrow keys while it has focus (Shift for bigger steps), sizes the window between the limits. */
  function renderGrip(entry: Entry, kind: string): HTMLElement {
    const grip = renderElement("div", { class: "ls-floating-window-resize", role: "separator", tabindex: "0", "aria-label": "Resize", title: "Drag to resize" });
    grip.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      const start = { x: event.clientX, y: event.clientY, width: entry.box.width, height: entry.box.height };
      grip.setPointerCapture?.(event.pointerId);
      const move = (next: PointerEvent): void => resizeTo(entry, start.width + next.clientX - start.x, start.height + next.clientY - start.y, kind);
      const end = (): void => {
        grip.removeEventListener("pointermove", move);
        grip.removeEventListener("pointerup", end);
        grip.removeEventListener("pointercancel", end);
      };
      grip.addEventListener("pointermove", move);
      grip.addEventListener("pointerup", end);
      grip.addEventListener("pointercancel", end);
    });
    grip.addEventListener("keydown", (event) => {
      const step = event.shiftKey ? RESIZE_STEP_SHIFT : RESIZE_STEP;
      const delta: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      const change = delta[event.key];
      if (!change) return;
      event.preventDefault();
      resizeTo(entry, entry.box.width + change[0], entry.box.height + change[1], kind);
    });
    return grip;
  }

  return {
    open,
    list: () => entries.map((entry) => entry.win),
    onChange(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    async closeAll() { await Promise.all(entries.map((entry) => entry.win.close())); },
  };
}

function headButton(label: string, icon: IconName): HTMLButtonElement {
  return renderElement("button", { class: "ls-floating-window-btn", type: "button", "aria-label": label, title: label, html: renderIcon(icon) });
}
