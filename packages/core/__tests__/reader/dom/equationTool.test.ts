/** @jest-environment jsdom */
// Tests how the equation box mode is reached: the Cmd/Ctrl+Alt+E shortcut and its cheatsheet row, and the toolbar's Extract equation toggle.
//
// Not covered here: the drag itself and the hidden-without-port / hidden-in-preview rule, which run through the reader UI wiring
// (readerUi.ts, boot flag hasEquationPort) that the spec gives no seam for.
//
// Assumptions: the toolbar takes `toggleEquationTool` in its actions (as `toggleBoxTool`) and names its button "Extract equation (...)".
import { deriveCheatsheetRows, resolveShortcut, type ShortcutContext, type ShortcutInput } from "../../../src/reader/keymap";
import { Toolbar, type ToolbarActions } from "../../../src/reader/dom/toolbar";

function ctx(overrides: Record<string, unknown> = {}): ShortcutContext {
  return { vimKeys: false, isMac: false, inTextInput: false, pendingPrefix: null, ...overrides } as ShortcutContext;
}

function key(overrides: Partial<ShortcutInput> & { key: string }): ShortcutInput {
  return { ctrl: false, meta: false, alt: false, shift: false, ...overrides };
}

describe("equation tool shortcut", () => {
  it("2.2b resolves Ctrl+Alt+E to toggleEquationTool off macOS", () => {
    expect(resolveShortcut(key({ key: "e", ctrl: true, alt: true }), ctx({ isMac: false })).action).toBe("toggleEquationTool");
  });

  it("2.2b resolves Cmd+Option+E to toggleEquationTool on macOS, also when Option rewrites the key", () => {
    expect(resolveShortcut(key({ key: "e", meta: true, alt: true }), ctx({ isMac: true })).action).toBe("toggleEquationTool");
    expect(resolveShortcut(key({ key: "Dead", code: "KeyE", meta: true, alt: true }), ctx({ isMac: true })).action).toBe("toggleEquationTool");
  });

  it("2.2b does not resolve the other platform's modifier, plain Alt+E or Ctrl+E", () => {
    expect(resolveShortcut(key({ key: "e", ctrl: true, alt: true }), ctx({ isMac: true })).action).toBeNull();
    expect(resolveShortcut(key({ key: "e", meta: true, alt: true }), ctx({ isMac: false })).action).toBeNull();
    expect(resolveShortcut(key({ key: "e", alt: true }), ctx({ isMac: false })).action).toBeNull();
    expect(resolveShortcut(key({ key: "e", ctrl: true }), ctx({ isMac: false })).action).not.toBe("toggleEquationTool");
  });

  it("2.2b leaves the text box shortcut on Alt+B", () => {
    expect(resolveShortcut(key({ key: "b", ctrl: true, alt: true }), ctx({ isMac: false })).action).toBe("toggleBoxTool");
  });

  it("2.2b lists the shortcut in the cheatsheet with the platform's modifier names", () => {
    const keysOf = (isMac: boolean) => deriveCheatsheetRows({ vimKeys: false, isMac }).flatMap((row) => row.keys);
    expect(keysOf(false)).toContain("Ctrl+Alt+E");
    expect(keysOf(true)).toContain("Cmd+Option+E");
  });
});

describe("equation tool toolbar button", () => {
  function setup() {
    document.body.innerHTML = `<div id="pdf-shell"><div id="toolbar"></div></div>`;
    const noop = () => undefined;
    const actions = {
      toggleSidebar: noop, previousPage: jest.fn(), nextPage: jest.fn(), toggleDetails: jest.fn(), selectTool: jest.fn(), selectColor: jest.fn(),
      openFind: noop, toggleBoxTool: noop, toggleEquationTool: jest.fn(), openAppearance: noop, openCheatsheet: noop,
    } as unknown as ToolbarActions & { toggleEquationTool: jest.Mock };
    const toolbar = new Toolbar(document.createElement("div"), false, true, actions);
    const button = document.querySelector<HTMLButtonElement>('#toolbar button[title^="Extract equation"]');
    return { toolbar, actions, button };
  }

  it("2.2b shows an Extract equation button that names the shortcut", () => {
    const { button } = setup();
    expect(button).not.toBeNull();
    expect(button!.title).toContain("Ctrl+Alt+E");
  });

  it("2.2b toggles the mode when the button is clicked", () => {
    const { actions, button } = setup();
    button!.click();
    expect(actions.toggleEquationTool).toHaveBeenCalledTimes(1);
  });

  it("2.2b reflects the mode on the button's pressed state", () => {
    const { toolbar, button } = setup();
    expect(button!.getAttribute("aria-pressed")).toBe("false");
    (toolbar as unknown as { setEquationToolActive(on: boolean): void }).setEquationToolActive(true);
    expect(button!.getAttribute("aria-pressed")).toBe("true");
    (toolbar as unknown as { setEquationToolActive(on: boolean): void }).setEquationToolActive(false);
    expect(button!.getAttribute("aria-pressed")).toBe("false");
  });
});
