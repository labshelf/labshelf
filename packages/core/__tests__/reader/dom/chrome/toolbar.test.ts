/**
 * @jest-environment jsdom
 */
// Tests the toolbar's layout: the existing buttons and the empty actions slot between the title and the right group.
import { Toolbar, type ToolbarActions } from "../../../../src/reader/dom/chrome/toolbar";

function setup() {
  document.body.innerHTML = `<div id="pdf-shell"><div id="toolbar"></div></div>`;
  const noop = () => undefined;
  const actions: ToolbarActions = { toggleSidebar: noop, historyBack: noop, historyForward: noop, openFind: noop, openTheme: noop, openCheatsheet: noop };
  const toolbar = new Toolbar(document.createElement("div"), "A paper", false, true, actions);
  return { toolbar, root: document.getElementById("toolbar")! };
}

describe("Toolbar", () => {
  it("keeps its six buttons", () => {
    const { root } = setup();
    const titles = [...root.querySelectorAll("button")].map((b) => b.title);
    expect(titles).toEqual([
      "Toggle sidebar (F4)", "Back (Alt+Left)", "Forward (Alt+Right)", "Find (Ctrl+F)", "Page theme", "Keyboard shortcuts (?)",
    ]);
  });

  it("exposes an empty hidden actions group between the title and the right group", () => {
    const { toolbar, root } = setup();
    expect(toolbar.actions).toBeInstanceOf(HTMLElement);
    expect(toolbar.actions.matches("div.rd-toolbar-group.rd-toolbar-actions")).toBe(true);
    expect(toolbar.actions.children).toHaveLength(0);
    expect(toolbar.actions.hidden).toBe(true);
    const kids = [...root.children];
    const at = kids.indexOf(toolbar.actions);
    expect(at).toBeGreaterThan(kids.findIndex((c) => c.classList.contains("rd-toolbar-title")));
    expect(at).toBe(kids.length - 2);
  });
});
