/** @jest-environment jsdom */
// Tests the reader's bars: the toolbar buttons, the roving-tabindex tab strip and the preview build banner.
import { Toolbar, type ToolbarActions, BuildBanner, TabList } from "../../../src/reader/dom/toolbar";

function setupToolbar() {
  document.body.innerHTML = `<div id="pdf-shell"><div id="toolbar"></div></div>`;
  const noop = () => undefined;
  const actions: ToolbarActions = { toggleSidebar: noop, historyBack: noop, historyForward: noop, openFind: noop, toggleBoxTool: noop, openTheme: noop, openCheatsheet: noop };
  const toolbar = new Toolbar(document.createElement("div"), "A paper", false, true, actions);
  return { toolbar, root: document.getElementById("toolbar")! };
}

describe("Toolbar", () => {
  it("keeps its seven buttons", () => {
    const { root } = setupToolbar();
    const titles = [...root.querySelectorAll("button")].map((b) => b.title);
    expect(titles).toEqual([
      "Toggle sidebar (F4)", "Back (Alt+Left)", "Forward (Alt+Right)", "Text box (Ctrl+Alt+B)", "Find (Ctrl+F)", "Page theme", "Keyboard shortcuts (?)",
    ]);
  });
});

type Id = "a" | "b" | "c";

function setupTabs(selected?: Id) {
  document.body.innerHTML = "";
  const onSelect = jest.fn();
  const tabs = new TabList<Id>(
    [{ id: "a", label: "Alpha", controls: "panel-a" }, { id: "b", label: "Beta" }, { id: "c", label: "Gamma" }],
    { label: "Letters", onSelect, ...(selected ? { selected } : {}) },
  );
  document.body.append(tabs.el);
  const buttons = [...tabs.el.querySelectorAll<HTMLButtonElement>("[role=tab]")];
  const key = (k: string) => tabs.el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
  return { tabs, onSelect, buttons, key };
}

const selectedOf = (buttons: HTMLButtonElement[]) => buttons.map((b) => b.getAttribute("aria-selected"));
const tabIndexOf = (buttons: HTMLButtonElement[]) => buttons.map((b) => b.tabIndex);

describe("TabList", () => {
  it("renders a labelled tablist of tabs, the first one selected and the only one in the tab order", () => {
    const { tabs, buttons } = setupTabs();
    expect(tabs.el.getAttribute("role")).toBe("tablist");
    expect(tabs.el.getAttribute("aria-label")).toBe("Letters");
    expect(buttons.map((b) => b.textContent)).toEqual(["Alpha", "Beta", "Gamma"]);
    expect(selectedOf(buttons)).toEqual(["true", "false", "false"]);
    expect(tabIndexOf(buttons)).toEqual([0, -1, -1]);
    expect(tabs.selected).toBe("a");
  });

  it("links a tab to the panel it controls", () => {
    const { buttons } = setupTabs();
    expect(buttons[0]?.getAttribute("aria-controls")).toBe("panel-a");
    expect(buttons[1]?.hasAttribute("aria-controls")).toBe(false);
  });

  it("starts on the given tab without reporting a selection", () => {
    const { tabs, buttons, onSelect } = setupTabs("c");
    expect(tabs.selected).toBe("c");
    expect(tabIndexOf(buttons)).toEqual([-1, -1, 0]);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("selects a tab on click", () => {
    const { tabs, buttons, onSelect } = setupTabs();
    buttons[1]?.click();
    expect(tabs.selected).toBe("b");
    expect(selectedOf(buttons)).toEqual(["false", "true", "false"]);
    expect(onSelect).toHaveBeenCalledWith("b");
  });

  it("moves the selection and focus with arrow keys, wrapping, and with Home and End", () => {
    const { tabs, buttons, key } = setupTabs();
    key("ArrowLeft");
    expect(tabs.selected).toBe("c");
    expect(document.activeElement).toBe(buttons[2]);
    key("ArrowRight");
    expect(tabs.selected).toBe("a");
    key("End");
    expect(tabs.selected).toBe("c");
    key("Home");
    expect(tabs.selected).toBe("a");
    expect(tabIndexOf(buttons)).toEqual([0, -1, -1]);
  });

  it("leaves other keys alone", () => {
    const { tabs, key, onSelect } = setupTabs();
    expect(key("Enter")).toBe(true);
    expect(tabs.selected).toBe("a");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("hands out a tab's button by id", () => {
    const { tabs, buttons } = setupTabs();
    expect(tabs.button("b")).toBe(buttons[1]);
  });
});

function setupBanner() {
  document.body.innerHTML = `<div id="build-banner" hidden></div>`;
  return { banner: new BuildBanner(), root: document.getElementById("build-banner")! };
}

describe("BuildBanner", () => {
  it("clears and reports a reload failure", () => {
    const { banner, root } = setupBanner();
    banner.showReloadError("HTTP 500");
    banner.clear();
    expect(root.hidden).toBe(true);
    expect(root.childElementCount).toBe(0);
    banner.showReloadError("HTTP 404");
    expect(root.hidden).toBe(false);
    expect(root.textContent).toBe("Could not reload the PDF: HTTP 404");
  });
});
