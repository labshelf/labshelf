import { deriveListShortcutAction, type ShortcutPress } from "../../src/libraryUi/listKeymap";

const press = (key: string, over: Partial<ShortcutPress> = {}): ShortcutPress =>
  ({ key, code: "", meta: false, ctrl: false, alt: false, shift: false, ...over });

describe("listKeyAction", () => {
  it("removes on Delete and on Cmd/Ctrl+Backspace, never on a plain Backspace", () => {
    expect(deriveListShortcutAction(press("Delete"))).toEqual({ kind: "remove" });
    expect(deriveListShortcutAction(press("Backspace", { meta: true }))).toEqual({ kind: "remove" });
    expect(deriveListShortcutAction(press("Backspace", { ctrl: true }))).toEqual({ kind: "remove" });
    expect(deriveListShortcutAction(press("Backspace"))).toBeNull();
  });

  it("sets the status with Alt+1, Alt+2 and Alt+3 by physical key", () => {
    expect(deriveListShortcutAction(press("¡", { alt: true, code: "Digit1" }))).toEqual({ kind: "setStatus", status: "unread" });
    expect(deriveListShortcutAction(press("™", { alt: true, code: "Digit2" }))).toEqual({ kind: "setStatus", status: "reading" });
    expect(deriveListShortcutAction(press("£", { alt: true, code: "Digit3" }))).toEqual({ kind: "setStatus", status: "done" });
    expect(deriveListShortcutAction(press("1", { code: "Digit1" }))).toEqual({ kind: "typeToSearch" });
  });

  it("copies cite keys with Cmd/Ctrl+C", () => {
    expect(deriveListShortcutAction(press("c", { meta: true }))).toEqual({ kind: "copyKeys" });
    expect(deriveListShortcutAction(press("c", { ctrl: true }))).toEqual({ kind: "copyKeys" });
  });

  it("pages with PageUp and PageDown, extending with Shift", () => {
    expect(deriveListShortcutAction(press("PageDown"))).toEqual({ kind: "page", dir: 1, extend: false });
    expect(deriveListShortcutAction(press("PageUp", { shift: true }))).toEqual({ kind: "page", dir: -1, extend: true });
  });

  it("keeps the navigation keys", () => {
    expect(deriveListShortcutAction(press("/"))).toEqual({ kind: "focusSearch" });
    expect(deriveListShortcutAction(press("f", { meta: true }))).toEqual({ kind: "focusSearch" });
    expect(deriveListShortcutAction(press("ArrowDown", { shift: true }))).toEqual({ kind: "step", delta: 1, extend: true });
    expect(deriveListShortcutAction(press("ArrowUp"))).toEqual({ kind: "step", delta: -1, extend: false });
    expect(deriveListShortcutAction(press("ArrowUp", { alt: true }))).toEqual({ kind: "parent" });
    expect(deriveListShortcutAction(press("Home"))).toEqual({ kind: "edge", to: "first" });
    expect(deriveListShortcutAction(press("End"))).toEqual({ kind: "edge", to: "last" });
    expect(deriveListShortcutAction(press("Enter"))).toEqual({ kind: "open" });
    expect(deriveListShortcutAction(press("Escape"))).toEqual({ kind: "escape" });
    expect(deriveListShortcutAction(press("a", { ctrl: true }))).toEqual({ kind: "selectAll" });
    expect(deriveListShortcutAction(press("x"))).toEqual({ kind: "typeToSearch" });
    expect(deriveListShortcutAction(press("x", { alt: true }))).toBeNull();
    expect(deriveListShortcutAction(press("Tab"))).toBeNull();
    expect(deriveListShortcutAction(press("ContextMenu"))).toEqual({ kind: "menu" });
    expect(deriveListShortcutAction(press("F10", { shift: true }))).toEqual({ kind: "menu" });
    expect(deriveListShortcutAction(press("F10"))).toBeNull();
  });

  it("maps ArrowRight to expand and ArrowLeft to collapse", () => {
    expect(deriveListShortcutAction(press("ArrowRight"))).toEqual({ kind: "expand" });
    expect(deriveListShortcutAction(press("ArrowLeft"))).toEqual({ kind: "collapse" });
  });
});
