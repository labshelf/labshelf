import { listKeyAction, type KeyPress } from "../../src/library-ui/listKeymap";

const press = (key: string, over: Partial<KeyPress> = {}): KeyPress =>
  ({ key, code: "", meta: false, ctrl: false, alt: false, shift: false, ...over });

describe("listKeyAction", () => {
  it("removes on Delete and on Cmd/Ctrl+Backspace, never on a plain Backspace", () => {
    expect(listKeyAction(press("Delete"))).toEqual({ kind: "remove" });
    expect(listKeyAction(press("Backspace", { meta: true }))).toEqual({ kind: "remove" });
    expect(listKeyAction(press("Backspace", { ctrl: true }))).toEqual({ kind: "remove" });
    expect(listKeyAction(press("Backspace"))).toBeNull();
  });

  it("sets the status with Alt+1, Alt+2 and Alt+3 by physical key", () => {
    expect(listKeyAction(press("¡", { alt: true, code: "Digit1" }))).toEqual({ kind: "setStatus", status: "unread" });
    expect(listKeyAction(press("™", { alt: true, code: "Digit2" }))).toEqual({ kind: "setStatus", status: "reading" });
    expect(listKeyAction(press("£", { alt: true, code: "Digit3" }))).toEqual({ kind: "setStatus", status: "done" });
    expect(listKeyAction(press("1", { code: "Digit1" }))).toEqual({ kind: "typeToSearch" });
  });

  it("copies cite keys with Cmd/Ctrl+C", () => {
    expect(listKeyAction(press("c", { meta: true }))).toEqual({ kind: "copyKeys" });
    expect(listKeyAction(press("c", { ctrl: true }))).toEqual({ kind: "copyKeys" });
  });

  it("pages with PageUp and PageDown, extending with Shift", () => {
    expect(listKeyAction(press("PageDown"))).toEqual({ kind: "page", dir: 1, extend: false });
    expect(listKeyAction(press("PageUp", { shift: true }))).toEqual({ kind: "page", dir: -1, extend: true });
  });

  it("keeps the navigation keys", () => {
    expect(listKeyAction(press("/"))).toEqual({ kind: "focusSearch" });
    expect(listKeyAction(press("f", { meta: true }))).toEqual({ kind: "focusSearch" });
    expect(listKeyAction(press("ArrowDown", { shift: true }))).toEqual({ kind: "step", delta: 1, extend: true });
    expect(listKeyAction(press("ArrowUp"))).toEqual({ kind: "step", delta: -1, extend: false });
    expect(listKeyAction(press("ArrowUp", { alt: true }))).toEqual({ kind: "parent" });
    expect(listKeyAction(press("Home"))).toEqual({ kind: "edge", to: "first" });
    expect(listKeyAction(press("End"))).toEqual({ kind: "edge", to: "last" });
    expect(listKeyAction(press("Enter"))).toEqual({ kind: "open" });
    expect(listKeyAction(press("Escape"))).toEqual({ kind: "escape" });
    expect(listKeyAction(press("a", { ctrl: true }))).toEqual({ kind: "selectAll" });
    expect(listKeyAction(press("x"))).toEqual({ kind: "typeToSearch" });
    expect(listKeyAction(press("x", { alt: true }))).toBeNull();
    expect(listKeyAction(press("Tab"))).toBeNull();
    expect(listKeyAction(press("ContextMenu"))).toEqual({ kind: "menu" });
    expect(listKeyAction(press("F10", { shift: true }))).toEqual({ kind: "menu" });
    expect(listKeyAction(press("F10"))).toBeNull();
  });

  it("maps ArrowRight to expand and ArrowLeft to collapse", () => {
    expect(listKeyAction(press("ArrowRight"))).toEqual({ kind: "expand" });
    expect(listKeyAction(press("ArrowLeft"))).toEqual({ kind: "collapse" });
  });
});
