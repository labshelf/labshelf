/** @jest-environment jsdom */
// Spec 2.1: the generic deck shell core in decks/dom/shell/ — the keyboard map.
// Every part is driven through its factory and read back from the DOM it builds; no format logic is involved.
// Acceptance ids: A4 covers all six parts (header, insert bar, status, zoom bar, keys, layout); each test name says which.
import { closeMenu } from "../../../../src/ui/dom/index.js";
import { bindShellKeys, type ShellKeyActions } from "../../../../src/decks/dom/shell/index.js";

afterEach(() => {
  closeMenu();
  document.body.replaceChildren();
});

describe("A4 keys", () => {
  const setPlatform = (platform: string): void => {
    Object.defineProperty(window.navigator, "platform", { value: platform, configurable: true });
    Object.defineProperty(window.navigator, "userAgent", { value: `Mozilla/5.0 (${platform})`, configurable: true });
  };
  const unbinders: Array<() => void> = [];
  beforeEach(() => setPlatform("Linux x86_64"));
  afterEach(() => { while (unbinders.length) unbinders.pop()!(); });

  const actionsOf = (): { [K in keyof ShellKeyActions]-?: jest.Mock } => ({
    undo: jest.fn(), redo: jest.fn(), zoomIn: jest.fn(), zoomOut: jest.fn(), fit: jest.fn(), setTool: jest.fn(), holdHand: jest.fn(),
    previous: jest.fn(), next: jest.fn(), deleteSelection: jest.fn(), clearSelection: jest.fn(), duplicate: jest.fn(),
  });
  const mount = (actions: ShellKeyActions) => {
    const root = document.createElement("div");
    const input = document.createElement("input");
    root.append(input);
    document.body.append(root);
    const unbind = bindShellKeys(root, actions);
    unbinders.push(unbind);
    return { root, unbind };
  };
  const press = (target: Element | Window, init: KeyboardEventInit & { key: string }, type: "keydown" | "keyup" = "keydown"): KeyboardEvent => {
    const event = new KeyboardEvent(type, { bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(event);
    return event;
  };

  const ctrl = { ctrlKey: true };
  const table: ReadonlyArray<[string, KeyboardEventInit & { key: string }, keyof ShellKeyActions, unknown[]]> = [
    ["Mod+Z", { key: "z", ...ctrl }, "undo", []],
    ["Mod+Shift+Z", { key: "Z", shiftKey: true, ...ctrl }, "redo", []],
    ["Mod+Y", { key: "y", ...ctrl }, "redo", []],
    ["Mod+=", { key: "=", ...ctrl }, "zoomIn", []],
    ["Mod++", { key: "+", shiftKey: true, ...ctrl }, "zoomIn", []],
    ["Mod+-", { key: "-", ...ctrl }, "zoomOut", []],
    ["Mod+0", { key: "0", ...ctrl }, "fit", []],
    ["Mod+D", { key: "d", ...ctrl }, "duplicate", []],
    ["V", { key: "v" }, "setTool", ["select"]],
    ["H", { key: "h" }, "setTool", ["hand"]],
    ["PageDown", { key: "PageDown" }, "next", []],
    ["PageUp", { key: "PageUp" }, "previous", []],
    ["Delete", { key: "Delete" }, "deleteSelection", []],
    ["Backspace", { key: "Backspace" }, "deleteSelection", []],
    ["Escape", { key: "Escape" }, "clearSelection", []],
  ];

  it.each(table)("A4 keys %s calls its action and is prevented", (_name, init, action, args) => {
    const actions = actionsOf();
    const { root } = mount(actions);
    const event = press(root, init);
    expect(actions[action]).toHaveBeenCalledTimes(1);
    expect(actions[action]).toHaveBeenCalledWith(...args);
    expect(event.defaultPrevented).toBe(true);
    for (const [other, fn] of Object.entries(actions)) if (other !== action) expect(fn).not.toHaveBeenCalled();
  });

  it.each(table)("A4 keys %s with no action is left alone", (_name, init) => {
    const { root } = mount({});
    expect(press(root, init).defaultPrevented).toBe(false);
  });

  it("A4 keys only the given actions are handled", () => {
    const undo = jest.fn();
    const { root } = mount({ undo });
    expect(press(root, { key: "z", ctrlKey: true }).defaultPrevented).toBe(true);
    expect(press(root, { key: "Delete" }).defaultPrevented).toBe(false);
    expect(press(root, { key: "Escape" }).defaultPrevented).toBe(false);
    expect(undo).toHaveBeenCalledTimes(1);
  });

  it("A4 keys Mod+Z needs ctrl on a non-Apple platform and ignores meta", () => {
    const actions = actionsOf();
    const { root } = mount(actions);
    expect(press(root, { key: "z", metaKey: true }).defaultPrevented).toBe(false);
    expect(actions.undo).not.toHaveBeenCalled();
  });

  it("A4 keys Mod is meta on Apple platforms and ctrl is ignored", () => {
    setPlatform("MacIntel");
    const actions = actionsOf();
    const { root } = mount(actions);
    expect(press(root, { key: "z", ctrlKey: true }).defaultPrevented).toBe(false);
    expect(actions.undo).not.toHaveBeenCalled();
    const event = press(root, { key: "z", metaKey: true });
    expect(event.defaultPrevented).toBe(true);
    expect(actions.undo).toHaveBeenCalledTimes(1);
  });

  it("A4 keys Mod+Shift+Z is redo and not undo", () => {
    const actions = actionsOf();
    const { root } = mount(actions);
    press(root, { key: "Z", shiftKey: true, ctrlKey: true });
    expect(actions.redo).toHaveBeenCalledTimes(1);
    expect(actions.undo).not.toHaveBeenCalled();
  });

  it("A4 keys Space keydown holds the hand and Space keyup on the window releases it", () => {
    const actions = actionsOf();
    const { root } = mount(actions);
    const down = press(root, { key: " ", code: "Space" });
    expect(actions.holdHand).toHaveBeenCalledTimes(1);
    expect(actions.holdHand).toHaveBeenLastCalledWith(true);
    expect(down.defaultPrevented).toBe(true);
    press(window, { key: " ", code: "Space" }, "keyup");
    expect(actions.holdHand).toHaveBeenCalledTimes(2);
    expect(actions.holdHand).toHaveBeenLastCalledWith(false);
  });

  it("A4 keys Space without holdHand is left alone", () => {
    const { root } = mount({});
    expect(press(root, { key: " ", code: "Space" }).defaultPrevented).toBe(false);
  });

  it("A4 keys Space keyup is heard even when the root never sees it", () => {
    const actions = actionsOf();
    mount(actions);
    press(document.body, { key: " ", code: "Space" }, "keyup");
    expect(actions.holdHand).toHaveBeenCalledWith(false);
  });

  it.each([
    ["input", () => document.createElement("input")],
    ["textarea", () => document.createElement("textarea")],
    ["select", () => document.createElement("select")],
    ["a child of .cm-editor", () => { const editor = document.createElement("div"); editor.className = "cm-editor"; const line = document.createElement("div"); editor.append(line); return line; }],
    ["a [contenteditable] element", () => { const el = document.createElement("div"); el.setAttribute("contenteditable", "true"); return el; }],
    ["a child of [contenteditable]", () => { const el = document.createElement("div"); el.setAttribute("contenteditable", "true"); const span = document.createElement("span"); el.append(span); return span; }],
  ])("A4 keys inside %s are ignored", (_name, make) => {
    const actions = actionsOf();
    const { root } = mount(actions);
    const target = make();
    root.append(target.closest("div") && target.parentElement && target.parentElement !== root ? target.parentElement : target);
    for (const init of [{ key: "Delete" }, { key: "z", ctrlKey: true }, { key: "v" }, { key: "PageDown" }, { key: "Escape" }, { key: " ", code: "Space" }]) {
      const event = press(target, init);
      expect(event.defaultPrevented).toBe(false);
    }
    for (const fn of Object.values(actions)) expect(fn).not.toHaveBeenCalled();
  });

  it("A4 keys already prevented events are ignored", () => {
    const actions = actionsOf();
    const { root } = mount(actions);
    const child = document.createElement("button");
    child.addEventListener("keydown", (event) => event.preventDefault());
    root.append(child);
    press(child, { key: "Delete" });
    expect(actions.deleteSelection).not.toHaveBeenCalled();
  });

  it("A4 keys a key on a plain element inside the root is handled", () => {
    const actions = actionsOf();
    const { root } = mount(actions);
    const child = document.createElement("div");
    root.append(child);
    press(child, { key: "Delete" });
    expect(actions.deleteSelection).toHaveBeenCalledTimes(1);
  });

  it("A4 keys events outside the root are not handled", () => {
    const actions = actionsOf();
    mount(actions);
    const outside = document.createElement("div");
    document.body.append(outside);
    press(outside, { key: "Delete" });
    expect(actions.deleteSelection).not.toHaveBeenCalled();
  });

  it("A4 keys unbind stops keydown and keyup handling", () => {
    const actions = actionsOf();
    const { root, unbind } = mount(actions);
    unbind();
    const event = press(root, { key: "Delete" });
    press(root, { key: "z", ctrlKey: true });
    press(root, { key: " ", code: "Space" });
    press(window, { key: " ", code: "Space" }, "keyup");
    expect(event.defaultPrevented).toBe(false);
    for (const fn of Object.values(actions)) expect(fn).not.toHaveBeenCalled();
  });
});
