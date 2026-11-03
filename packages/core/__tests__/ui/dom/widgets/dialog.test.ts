/**
 * @jest-environment jsdom
 */
// Tests that the confirmation dialog is named by its title and described by its message, and the overlay's fullscreen and
// Escape options, the topmost overlay owning Escape and Tab, and the focus trap.
import { mountOverlay, showDialog } from "../../../../src/ui/dom/widgets/dialog";

afterEach(() => { document.body.innerHTML = ""; });

const textOf = (ids: string | null): string =>
  (ids ?? "").split(" ").map((id) => document.getElementById(id)?.textContent ?? "").join(" ");

describe("showDialog accessible name", () => {
  it("labels the alertdialog with its title and describes it with its message", () => {
    void showDialog({ title: "Stop sharing?", message: "Others lose access.", buttons: [{ id: "ok", label: "OK" }] });
    const box = document.querySelector('[role="alertdialog"]')!;
    expect(textOf(box.getAttribute("aria-labelledby"))).toBe("Stop sharing?");
    expect(textOf(box.getAttribute("aria-describedby"))).toBe("Others lose access.");
  });

  it("gives each open dialog its own ids and no description without a message", () => {
    void showDialog({ title: "One", buttons: [] });
    void showDialog({ title: "Two", buttons: [] });
    const boxes = [...document.querySelectorAll('[role="alertdialog"]')];
    expect(boxes.map((b) => textOf(b.getAttribute("aria-labelledby")))).toEqual(["One", "Two"]);
    expect(boxes[0]!.hasAttribute("aria-describedby")).toBe(false);
  });
});

describe("mountOverlay", () => {
  const closers: Array<() => void> = [];
  afterEach(() => { while (closers.length > 0) closers.pop()!(); });

  /** Mounts `content` as an overlay, closed after the test. */
  function overlay(content: HTMLElement, onDismiss: () => void, opts: Parameters<typeof mountOverlay>[2] = {}): { close: () => void } {
    const handle = mountOverlay(content, onDismiss, opts);
    closers.push(handle.close);
    return handle;
  }

  const box = (...children: HTMLElement[]): HTMLElement => {
    const element = document.createElement("div");
    element.append(...children);
    return element;
  };

  const press = (key: string, shiftKey = false): KeyboardEvent => {
    const event = new KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true });
    (document.activeElement ?? document.body).dispatchEvent(event);
    return event;
  };

  const scrimOf = (content: HTMLElement): HTMLElement => content.previousElementSibling as HTMLElement;

  it("dismisses a plain overlay on a scrim mousedown", () => {
    const content = box();
    const onDismiss = jest.fn();
    overlay(content, onDismiss);
    scrimOf(content).dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(content.isConnected).toBe(false);
  });

  it("keeps a fullscreen overlay open on a scrim mousedown", () => {
    const content = box();
    const onDismiss = jest.fn();
    overlay(content, onDismiss, { fullscreen: true });
    scrimOf(content).dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(onDismiss).not.toHaveBeenCalled();
    expect(content.isConnected).toBe(true);
  });

  it("dismisses on Escape when onEscape returns false", () => {
    const content = box();
    const onDismiss = jest.fn();
    const onEscape = jest.fn(() => false);
    overlay(content, onDismiss, { onEscape });
    const event = press("Escape");
    expect(onEscape).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
    expect(content.isConnected).toBe(false);
  });

  it("stays open on Escape when onEscape returns true", () => {
    const content = box();
    const onDismiss = jest.fn();
    const onEscape = jest.fn(() => true);
    overlay(content, onDismiss, { onEscape });
    press("Escape");
    expect(onEscape).toHaveBeenCalledTimes(1);
    expect(onDismiss).not.toHaveBeenCalled();
    expect(content.isConnected).toBe(true);
  });

  it("lets only the topmost overlay answer Escape", () => {
    const lower = box();
    const upper = box();
    const lowerDismiss = jest.fn();
    const upperDismiss = jest.fn();
    overlay(lower, lowerDismiss);
    overlay(upper, upperDismiss);
    press("Escape");
    expect(upperDismiss).toHaveBeenCalledTimes(1);
    expect(lowerDismiss).not.toHaveBeenCalled();
    expect(lower.isConnected).toBe(true);
    press("Escape");
    expect(lowerDismiss).toHaveBeenCalledTimes(1);
  });

  it("lets only the topmost overlay trap Tab", () => {
    const lowerButton = document.createElement("button");
    const upperFirst = document.createElement("button");
    const upperLast = document.createElement("button");
    overlay(box(lowerButton), jest.fn());
    overlay(box(upperFirst, upperLast), jest.fn());
    upperLast.focus();
    const event = press("Tab");
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(upperFirst);
  });

  it("traps focus over select, textarea and a[href]", () => {
    const select = document.createElement("select");
    const textarea = document.createElement("textarea");
    const link = document.createElement("a");
    link.href = "#x";
    overlay(box(select, textarea, link), jest.fn());
    link.focus();
    expect(press("Tab").defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(select);
    expect(press("Tab", true).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(link);
    textarea.focus();
    expect(press("Tab").defaultPrevented).toBe(false);
  });
});
