/**
 * @jest-environment jsdom
 */
// Tests the toolbar's layout: the existing buttons.
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
});
