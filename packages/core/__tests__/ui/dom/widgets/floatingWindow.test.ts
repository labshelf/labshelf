/** @jest-environment jsdom */
// Tests the non-modal floating windows: what open mounts, dragging the head, resizing by the grip and the arrow keys within the limits, clamping into the
// viewport, the stacking cap and raising, Escape, the size kept per kind, the 24px offset of successive windows, and close, closeAll and onChange.
import * as widgets from "../../../../src/ui/dom/widgets/index";
import { createFloatingWindows, type FloatingWindow, type FloatingWindows } from "../../../../src/ui/dom/widgets/floatingWindow";

const VIEW_W = 1200;
const VIEW_H = 800;

// jsdom does no layout: every element reports the box its inline left, top, width and height give, so the tests see what the window set on itself.
const px = (value: string): number => (value.endsWith("px") ? parseFloat(value) : 0);
const num = (el: HTMLElement, key: "left" | "top" | "width" | "height"): number => px(el.style[key]);
const realRect = HTMLElement.prototype.getBoundingClientRect;
const realPointerCapture = (Element.prototype as { setPointerCapture?: unknown }).setPointerCapture;

beforeAll(() => {
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement): DOMRect {
    const left = px(this.style.left);
    const top = px(this.style.top);
    const width = px(this.style.width);
    const height = px(this.style.height);
    return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) } as DOMRect;
  };
  for (const name of ["offsetWidth", "offsetHeight"] as const) {
    Object.defineProperty(HTMLElement.prototype, name, { configurable: true, get(this: HTMLElement) { return px(this.style[name === "offsetWidth" ? "width" : "height"]); } });
  }
  const proto = Element.prototype as unknown as Record<string, unknown>;
  proto.setPointerCapture = () => undefined;
  proto.releasePointerCapture = () => undefined;
  proto.hasPointerCapture = () => false;
});

afterAll(() => {
  HTMLElement.prototype.getBoundingClientRect = realRect;
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).offsetWidth;
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).offsetHeight;
  (Element.prototype as unknown as Record<string, unknown>).setPointerCapture = realPointerCapture;
});

let manager: FloatingWindows;
let root: HTMLElement;
let kindCounter = 0;
/** The size memory is module-level, so every test uses its own kind. */
const freshKind = (): string => `kind-${++kindCounter}`;

function setViewport(width: number, height: number): void {
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: width });
  Object.defineProperty(window, "innerHeight", { configurable: true, writable: true, value: height });
}

beforeEach(() => {
  setViewport(VIEW_W, VIEW_H);
  root = document.createElement("div");
  document.body.append(root);
  manager = createFloatingWindows({ root });
});

afterEach(async () => {
  await manager?.closeAll();
  document.body.innerHTML = "";
});

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function pointer(target: Element, type: string, x: number, y: number): void {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
  Object.defineProperty(event, "pointerId", { value: 1 });
  target.dispatchEvent(event);
}
function drag(target: Element, from: [number, number], to: [number, number]): void {
  pointer(target, "pointerdown", from[0], from[1]);
  pointer(target, "pointermove", to[0], to[1]);
  pointer(target, "pointerup", to[0], to[1]);
}
function press(target: Element, key: string, shiftKey = false): void {
  target.dispatchEvent(new KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true }));
}
function click(target: Element): void {
  pointer(target, "pointerdown", 5, 5);
  target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  pointer(target, "pointerup", 5, 5);
  target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
  target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
}

const open = (kind = freshKind(), extra: Record<string, unknown> = {}): FloatingWindow => manager.open({ kind, title: `Title of ${kind}`, ...extra });
const head = (win: FloatingWindow): HTMLElement => win.element.querySelector<HTMLElement>(".ls-floating-window-head")!;
const grip = (win: FloatingWindow): HTMLElement => win.element.querySelector<HTMLElement>('[aria-label="Resize"], [role="separator"], [class*="resize"], [class*="grip"]')!;
const button = (win: FloatingWindow, label: string): HTMLElement | null => win.element.querySelector<HTMLElement>(`button[aria-label="${label}"], [role="button"][aria-label="${label}"]`);
const zIndex = (win: FloatingWindow): number => parseInt(win.element.style.zIndex || "0", 10);
const inside = (win: FloatingWindow, width = VIEW_W, height = VIEW_H): void => {
  expect(num(win.element, "left")).toBeGreaterThanOrEqual(0);
  expect(num(win.element, "top")).toBeGreaterThanOrEqual(0);
  expect(num(win.element, "left") + num(win.element, "width")).toBeLessThanOrEqual(width);
  expect(num(win.element, "top") + num(win.element, "height")).toBeLessThanOrEqual(height);
};

describe("7.2a a floating window", () => {
  it("7.2a mounts a non-modal dialog named by its title in the root", () => {
    const win = manager.open({ kind: freshKind(), title: "Notes of the paper" });
    expect(root.contains(win.element)).toBe(true);
    expect(win.element.classList.contains("ls-floating-window")).toBe(true);
    expect(win.element.getAttribute("role")).toBe("dialog");
    expect(win.element.getAttribute("aria-modal")).not.toBe("true");
    expect(win.element.getAttribute("aria-label")).toBe("Notes of the paper");
    expect(win.title).toBe("Notes of the paper");
    expect(win.closed).toBe(false);
  });

  it("7.2a mounts in document.body when no root is given", async () => {
    const own = createFloatingWindows();
    const win = own.open({ kind: freshKind(), title: "In the body" });
    expect(win.element.parentElement).toBe(document.body);
    await own.closeAll();
  });

  it("7.2a has a head with the title, a body, a close button and a resize grip, and is fixed", () => {
    const win = open(freshKind(), { title: "Head title" });
    expect(head(win).textContent).toContain("Head title");
    expect(win.element.contains(win.body)).toBe(true);
    expect(win.body.classList.contains("ls-floating-window-body")).toBe(true);
    expect(win.element.contains(head(win))).toBe(true);
    expect(head(win).contains(win.body)).toBe(false);
    expect(button(win, "Close")).not.toBeNull();
    expect(head(win).contains(button(win, "Close"))).toBe(true);
    expect(grip(win)).not.toBeNull();
    expect(win.element.style.position === "fixed" || win.element.style.position === "").toBe(true);
  });

  it("7.2a adds no scrim and leaves the page behind usable", () => {
    const page = document.createElement("button");
    document.body.append(page);
    const win = open();
    page.focus();
    expect(document.activeElement).toBe(page);
    expect(document.querySelector(".ls-overlay, .ls-scrim, .ls-dialog-scrim")).toBeNull();
    expect(win.element.parentElement).toBe(root);
  });

  it("7.2a shows the kind icon in the head only when an icon is given", () => {
    const withIcon = open(freshKind(), { icon: "file-text" });
    const without = open(freshKind());
    expect(head(withIcon).querySelectorAll("svg").length).toBeGreaterThan(head(without).querySelectorAll("svg").length);
  });

  it("7.2a has an Open button only when onOpen is given", () => {
    const plain = open();
    const withOpen = open(freshKind(), { onOpen: () => undefined });
    expect(button(plain, "Open")).toBeNull();
    expect(button(withOpen, "Open")).not.toBeNull();
    expect(head(withOpen).contains(button(withOpen, "Open"))).toBe(true);
  });

  it("7.2a calls onOpen when the Open button is clicked, and does not close the window", () => {
    const onOpen = jest.fn();
    const win = open(freshKind(), { onOpen });
    expect(onOpen).not.toHaveBeenCalled();
    click(button(win, "Open")!);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(win.closed).toBe(false);
  });

  it("7.2a closes the window when the Close button is clicked", async () => {
    const win = open();
    click(button(win, "Close")!);
    await flush();
    expect(win.closed).toBe(true);
    expect(root.contains(win.element)).toBe(false);
  });

  it("7.2a lists the open windows in open order with distinct ids", () => {
    const first = open();
    const second = open();
    expect(manager.list()).toEqual([first, second]);
    expect(first.id).not.toBe(second.id);
  });

  it("7.2a exports createFloatingWindows from widgets/index", () => {
    expect(typeof widgets.createFloatingWindows).toBe("function");
  });
});

describe("7.2b moving, resizing and clamping", () => {
  it("7.2b opens at 520x420 by default", () => {
    const win = open();
    expect(num(win.element, "width")).toBe(520);
    expect(num(win.element, "height")).toBe(420);
  });

  it("7.2b clamps the default size to 95vw x 90vh in a small viewport", async () => {
    setViewport(400, 300);
    const win = open();
    expect(num(win.element, "width")).toBeLessThanOrEqual(380);
    expect(num(win.element, "height")).toBeLessThanOrEqual(270);
    expect(num(win.element, "width")).toBeGreaterThanOrEqual(320);
    expect(num(win.element, "height")).toBeGreaterThanOrEqual(220);
    inside(win, 400, 300);
  });

  it("7.2b moves the window with the pointer dragged on the head", () => {
    const win = open();
    const left = num(win.element, "left");
    const top = num(win.element, "top");
    drag(head(win), [400, 300], [460, 340]);
    expect(num(win.element, "left")).toBe(left + 60);
    expect(num(win.element, "top")).toBe(top + 40);
  });

  it("7.2b stops moving after the pointer is released", () => {
    const win = open();
    drag(head(win), [400, 300], [440, 320]);
    const left = num(win.element, "left");
    const top = num(win.element, "top");
    pointer(head(win), "pointermove", 600, 600);
    expect(num(win.element, "left")).toBe(left);
    expect(num(win.element, "top")).toBe(top);
  });

  it("7.2b does not start a move from a pointerdown on a head button", () => {
    const win = open();
    const left = num(win.element, "left");
    const top = num(win.element, "top");
    const close = button(win, "Close")!;
    pointer(close, "pointerdown", 400, 300);
    pointer(close, "pointermove", 500, 400);
    pointer(close, "pointerup", 500, 400);
    expect(num(win.element, "left")).toBe(left);
    expect(num(win.element, "top")).toBe(top);
  });

  it("7.2b keeps a window dragged past the viewport edges inside the viewport", () => {
    const win = open();
    drag(head(win), [400, 300], [-5000, -5000]);
    inside(win);
    drag(head(win), [400, 300], [9000, 9000]);
    inside(win);
  });

  it("7.2b resizes by the grip dragged with the pointer", () => {
    const win = open();
    drag(grip(win), [500, 500], [540, 530]);
    expect(num(win.element, "width")).toBe(560);
    expect(num(win.element, "height")).toBe(450);
  });

  it("7.2b never shrinks below 320x220 by the grip", () => {
    const win = open();
    drag(grip(win), [800, 800], [0, 0]);
    expect(num(win.element, "width")).toBe(320);
    expect(num(win.element, "height")).toBe(220);
  });

  it("7.2b never grows past 95vw x 90vh by the grip", () => {
    const win = open();
    drag(grip(win), [500, 500], [9000, 9000]);
    expect(num(win.element, "width")).toBeLessThanOrEqual(VIEW_W * 0.95);
    expect(num(win.element, "height")).toBeLessThanOrEqual(VIEW_H * 0.9);
    expect(num(win.element, "width")).toBeGreaterThan(520);
    expect(num(win.element, "height")).toBeGreaterThan(420);
  });

  it("7.2b resizes by 16px per arrow key on the focused grip", () => {
    const win = open();
    press(grip(win), "ArrowRight");
    expect(num(win.element, "width")).toBe(536);
    press(grip(win), "ArrowDown");
    expect(num(win.element, "height")).toBe(436);
    press(grip(win), "ArrowLeft");
    press(grip(win), "ArrowLeft");
    expect(num(win.element, "width")).toBe(504);
    press(grip(win), "ArrowUp");
    expect(num(win.element, "height")).toBe(420);
  });

  it("7.2b resizes by 64px per arrow key with Shift", () => {
    const win = open();
    press(grip(win), "ArrowRight", true);
    expect(num(win.element, "width")).toBe(584);
    press(grip(win), "ArrowDown", true);
    expect(num(win.element, "height")).toBe(484);
    press(grip(win), "ArrowLeft", true);
    expect(num(win.element, "width")).toBe(520);
    press(grip(win), "ArrowUp", true);
    expect(num(win.element, "height")).toBe(420);
  });

  it("7.2b clamps the arrow-key resize to the minimum", () => {
    const win = open();
    for (let i = 0; i < 10; i += 1) { press(grip(win), "ArrowLeft", true); press(grip(win), "ArrowUp", true); }
    expect(num(win.element, "width")).toBe(320);
    expect(num(win.element, "height")).toBe(220);
  });

  it("7.2b clamps the arrow-key resize to the maximum", () => {
    const win = open();
    for (let i = 0; i < 30; i += 1) { press(grip(win), "ArrowRight", true); press(grip(win), "ArrowDown", true); }
    expect(num(win.element, "width")).toBeLessThanOrEqual(VIEW_W * 0.95);
    expect(num(win.element, "height")).toBeLessThanOrEqual(VIEW_H * 0.9);
    expect(num(win.element, "width")).toBeGreaterThan(520);
  });

  it("7.2b ignores keys other than the arrows on the grip", () => {
    const win = open();
    press(grip(win), "a");
    expect(num(win.element, "width")).toBe(520);
    expect(num(win.element, "height")).toBe(420);
  });

  it("7.2b clamps a window into the viewport when the window is resized", () => {
    const win = open();
    expect(num(win.element, "left") + num(win.element, "width")).toBeGreaterThan(700);
    setViewport(700, 500);
    window.dispatchEvent(new Event("resize"));
    inside(win, 700, 500);
  });

  it("7.2b clamps a window into the viewport on bringIntoView and raises it", () => {
    const first = open();
    const second = open();
    setViewport(700, 500);
    first.bringIntoView();
    inside(first, 700, 500);
    expect(first.element.classList.contains("is-front")).toBe(true);
    expect(second.element.classList.contains("is-front")).toBe(false);
    expect(zIndex(first)).toBeGreaterThan(zIndex(second));
  });
});

describe("7.2c stacking, raising and Escape", () => {
  it("7.2c closes the oldest when a fifth window opens", async () => {
    const wins = [open(), open(), open(), open()];
    expect(manager.list()).toHaveLength(4);
    const fifth = open();
    await flush();
    expect(wins[0]!.closed).toBe(true);
    expect(root.contains(wins[0]!.element)).toBe(false);
    expect(manager.list()).toEqual([wins[1], wins[2], wins[3], fifth]);
  });

  it("7.2c closes the oldest by open order even when it was raised last", async () => {
    const wins = [open(), open(), open(), open()];
    wins[0]!.raise();
    open();
    await flush();
    expect(wins[0]!.closed).toBe(true);
    expect(wins[1]!.closed).toBe(false);
  });

  it("7.2c honours a smaller max", async () => {
    const small = createFloatingWindows({ root, max: 2 });
    const a = small.open({ kind: freshKind(), title: "a" });
    const b = small.open({ kind: freshKind(), title: "b" });
    const c = small.open({ kind: freshKind(), title: "c" });
    await flush();
    expect(a.closed).toBe(true);
    expect(small.list()).toEqual([b, c]);
    await small.closeAll();
  });

  it("7.2c raises a window above the others when it is clicked", () => {
    const a = open();
    const b = open();
    click(a.body);
    expect(a.element.classList.contains("is-front")).toBe(true);
    expect(b.element.classList.contains("is-front")).toBe(false);
    expect(zIndex(a)).toBeGreaterThan(zIndex(b));
    click(b.body);
    expect(b.element.classList.contains("is-front")).toBe(true);
    expect(a.element.classList.contains("is-front")).toBe(false);
    expect(zIndex(b)).toBeGreaterThan(zIndex(a));
  });

  it("7.2c raises a window when focus moves inside it", () => {
    const a = open();
    const b = open();
    const input = document.createElement("input");
    a.body.append(input);
    input.focus();
    expect(a.element.classList.contains("is-front")).toBe(true);
    expect(zIndex(a)).toBeGreaterThan(zIndex(b));
  });

  it("7.2c raises a window with raise()", () => {
    const a = open();
    const b = open();
    a.raise();
    expect(a.element.classList.contains("is-front")).toBe(true);
    expect(zIndex(a)).toBeGreaterThan(zIndex(b));
    b.raise();
    expect(zIndex(b)).toBeGreaterThan(zIndex(a));
    expect(a.element.classList.contains("is-front")).toBe(false);
  });

  it("7.2c closes only the window Escape is pressed in", async () => {
    const a = open();
    const b = open();
    press(a.body, "Escape");
    await flush();
    expect(a.closed).toBe(true);
    expect(b.closed).toBe(false);
    expect(manager.list()).toEqual([b]);
  });

  it("7.2c stops the Escape from propagating out of the window", () => {
    const a = open();
    const seen = jest.fn();
    document.addEventListener("keydown", seen);
    press(a.body, "Escape");
    document.removeEventListener("keydown", seen);
    expect(seen).not.toHaveBeenCalled();
  });

  it("7.2c does nothing for an Escape outside every window", async () => {
    const a = open();
    const b = open();
    press(document.body, "Escape");
    await flush();
    expect(a.closed).toBe(false);
    expect(b.closed).toBe(false);
  });

  it("7.2c does not close a window for other keys", async () => {
    const a = open();
    press(a.body, "Enter");
    await flush();
    expect(a.closed).toBe(false);
  });
});

describe("7.2d size memory and placement", () => {
  it("7.2d opens a new window of a kind at that kind's last size", () => {
    const kind = freshKind();
    const first = open(kind);
    press(grip(first), "ArrowRight");
    press(grip(first), "ArrowDown", true);
    const second = open(kind);
    expect(num(second.element, "width")).toBe(536);
    expect(num(second.element, "height")).toBe(484);
  });

  it("7.2d keeps the size of a kind after its windows are closed", async () => {
    const kind = freshKind();
    const first = open(kind);
    press(grip(first), "ArrowRight", true);
    await first.close();
    const second = open(kind);
    expect(num(second.element, "width")).toBe(584);
  });

  it("7.2d keeps sizes apart per kind", () => {
    const first = open(freshKind());
    press(grip(first), "ArrowRight", true);
    const other = open(freshKind());
    expect(num(other.element, "width")).toBe(520);
  });

  it("7.2d keeps the size across managers", () => {
    const kind = freshKind();
    press(grip(open(kind)), "ArrowDown", true);
    const other = createFloatingWindows({ root });
    const win = other.open({ kind, title: "again" });
    expect(num(win.element, "height")).toBe(484);
  });

  it("7.2d opens the first window centred", () => {
    const win = open();
    const centreX = num(win.element, "left") + num(win.element, "width") / 2;
    const centreY = num(win.element, "top") + num(win.element, "height") / 2;
    expect(Math.abs(centreX - VIEW_W / 2)).toBeLessThanOrEqual(2);
    expect(Math.abs(centreY - VIEW_H / 2)).toBeLessThanOrEqual(2);
  });

  it("7.2d offsets each next window by 24px right and down", () => {
    const kind = freshKind();
    const a = open(kind);
    const b = open(kind);
    const c = open(kind);
    expect(num(b.element, "left") - num(a.element, "left")).toBe(24);
    expect(num(b.element, "top") - num(a.element, "top")).toBe(24);
    expect(num(c.element, "left") - num(b.element, "left")).toBe(24);
    expect(num(c.element, "top") - num(b.element, "top")).toBe(24);
  });

  it("7.2d offsets from the last opened window, not from the front one", () => {
    const kind = freshKind();
    const a = open(kind);
    const b = open(kind);
    a.raise();
    const c = open(kind);
    expect(num(c.element, "left") - num(b.element, "left")).toBe(24);
    expect(num(c.element, "top") - num(b.element, "top")).toBe(24);
  });

  it("7.2d clamps the offset windows into a small viewport", () => {
    setViewport(700, 500);
    const kind = freshKind();
    const wins = [open(kind), open(kind), open(kind), open(kind)];
    for (const win of wins) inside(win, 700, 500);
  });
});

describe("7.2e close, closeAll and onChange", () => {
  it("7.2e awaits onClose before removing the element", async () => {
    let release: () => void = () => undefined;
    const onClose = jest.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    const win = open(freshKind(), { onClose });
    const closing = win.close();
    await flush();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(root.contains(win.element)).toBe(true);
    expect(win.closed).toBe(false);
    release();
    await closing;
    expect(root.contains(win.element)).toBe(false);
    expect(win.closed).toBe(true);
  });

  it("7.2e notifies onChange only after the window is closed", async () => {
    let release: () => void = () => undefined;
    const win = open(freshKind(), { onClose: () => new Promise<void>((resolve) => { release = resolve; }) });
    const listener = jest.fn();
    manager.onChange(listener);
    const closing = win.close();
    await flush();
    expect(listener).not.toHaveBeenCalled();
    release();
    await closing;
    expect(listener).toHaveBeenCalledTimes(1);
    expect(manager.list()).toEqual([]);
  });

  it("7.2e makes a second close a no-op", async () => {
    const onClose = jest.fn();
    const win = open(freshKind(), { onClose });
    const listener = jest.fn();
    manager.onChange(listener);
    await win.close();
    await win.close();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("7.2e makes a concurrent second close a no-op", async () => {
    const onClose = jest.fn();
    const win = open(freshKind(), { onClose });
    await Promise.all([win.close(), win.close()]);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(win.closed).toBe(true);
  });

  it("7.2e still closes when onClose throws", async () => {
    const win = open(freshKind(), { onClose: () => { throw new Error("flush failed"); } });
    await win.close().catch(() => undefined);
    expect(win.closed).toBe(true);
    expect(root.contains(win.element)).toBe(false);
    expect(manager.list()).toEqual([]);
  });

  it("7.2e still closes when onClose rejects", async () => {
    const win = open(freshKind(), { onClose: () => Promise.reject(new Error("flush failed")) });
    await win.close().catch(() => undefined);
    expect(win.closed).toBe(true);
    expect(root.contains(win.element)).toBe(false);
  });

  it("7.2e closeAll closes every window and awaits their onClose", async () => {
    const closed: string[] = [];
    const wins = ["a", "b", "c"].map((name) => open(freshKind(), { onClose: async () => { await flush(); closed.push(name); } }));
    await manager.closeAll();
    expect(closed.sort()).toEqual(["a", "b", "c"]);
    expect(wins.every((win) => win.closed)).toBe(true);
    expect(manager.list()).toEqual([]);
    expect(root.querySelector(".ls-floating-window")).toBeNull();
  });

  it("7.2e closeAll is fine with no window open", async () => {
    await expect(manager.closeAll()).resolves.toBeUndefined();
  });

  it("7.2e notifies onChange after an open", () => {
    const listener = jest.fn();
    manager.onChange(listener);
    const win = open();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(manager.list()).toEqual([win]);
  });

  it("7.2e notifies onChange after a close", async () => {
    const win = open();
    const listener = jest.fn();
    manager.onChange(listener);
    await win.close();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("7.2e notifies onChange after a title change and updates the head and aria-label", () => {
    const win = open(freshKind(), { title: "Before" });
    const listener = jest.fn();
    manager.onChange(listener);
    win.title = "After";
    expect(listener).toHaveBeenCalledTimes(1);
    expect(win.title).toBe("After");
    expect(win.element.getAttribute("aria-label")).toBe("After");
    expect(head(win).textContent).toContain("After");
    expect(head(win).textContent).not.toContain("Before");
  });

  it("7.2e stops notifying after the returned unsubscribe is called", () => {
    const listener = jest.fn();
    const off = manager.onChange(listener);
    off();
    open();
    expect(listener).not.toHaveBeenCalled();
  });
});
