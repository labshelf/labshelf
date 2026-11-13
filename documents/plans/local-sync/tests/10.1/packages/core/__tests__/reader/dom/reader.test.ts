/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions": ["node", "node-addons"]}
 */
// Tests the reader toolbar's consult entry: a Consult button and a chips strip (one chip per open consult window) that stay hidden until setConsult
// gives the toolbar a chooser and a window manager, and hide again on setConsult(undefined).
import { Toolbar, type ToolbarActions } from "../../../src/reader/dom/toolbar";
import { createFloatingWindows, type FloatingWindows } from "../../../src/ui/dom/widgets/floatingWindow";
import { renderConsultChips } from "../../../src/writing/consult/dom/consultFooter";

const flush = async (): Promise<void> => { for (let i = 0; i < 5; i++) { await new Promise((resolve) => setTimeout(resolve, 0)); } };

let windows: FloatingWindows;
let windowsRoot: HTMLElement;

function setupToolbar() {
  document.body.innerHTML = `<div id="pdf-shell"><div id="toolbar"></div></div>`;
  const noop = () => undefined;
  const actions: ToolbarActions = { toggleSidebar: noop, previousPage: noop, nextPage: noop, toggleDetails: noop, selectTool: noop, selectColor: noop, openFind: noop, toggleBoxTool: noop, toggleEquationTool: noop, openAppearance: noop, openCheatsheet: noop };
  const container = document.createElement("div");
  const toolbar = new Toolbar(container, false, true, actions);
  windowsRoot = document.createElement("div");
  document.body.append(windowsRoot);
  windows = createFloatingWindows({ root: windowsRoot });
  return { toolbar, container, root: document.getElementById("toolbar")! };
}

const isHidden = (el: Element): boolean => el.closest("[hidden]") !== null;
const consultButton = (root: HTMLElement): HTMLButtonElement | null => root.querySelector<HTMLButtonElement>('button[aria-label="Consult"]');
const visibleChips = (root: HTMLElement): HTMLElement[] => [...root.querySelectorAll<HTMLElement>(".ls-consult-chip")].filter((chip) => !isHidden(chip));
const chipTitles = (root: HTMLElement): (string | undefined)[] => visibleChips(root).map((chip) => chip.querySelector(".ls-consult-chip-title")?.textContent ?? chip.textContent?.trim());

afterEach(async () => {
  await windows.closeAll();
  document.body.replaceChildren();
});

describe("Toolbar consult", () => {
  it("10.1c has no visible Consult button until setConsult is called", () => {
    const { root } = setupToolbar();
    const button = consultButton(root);
    expect(button === null || isHidden(button)).toBe(true);
  });

  it("10.1c has no visible chip before setConsult even when a window is open", () => {
    const { root } = setupToolbar();
    windows.open({ kind: "paper", title: "Smith 2020" });
    expect(visibleChips(root)).toHaveLength(0);
  });

  it("10.1c setConsult shows a Consult button labelled and titled Consult", () => {
    const { toolbar, root } = setupToolbar();
    toolbar.setConsult({ choose: jest.fn(), windows });
    const button = consultButton(root);
    expect(button).not.toBeNull();
    expect(isHidden(button!)).toBe(false);
    expect(button!.title).toBe("Consult");
    expect(button!.querySelector("svg")).not.toBeNull();
  });

  it("10.1c the Consult button sits in the end group before the Find button", () => {
    const { toolbar, root } = setupToolbar();
    toolbar.setConsult({ choose: jest.fn(), windows });
    const end = root.querySelector(".rd-toolbar-end")!;
    const buttons = [...end.querySelectorAll("button")];
    const find = buttons.findIndex((b) => b.title.startsWith("Find"));
    expect(find).toBeGreaterThan(-1);
    expect(buttons.findIndex((b) => b.getAttribute("aria-label") === "Consult")).toBeLessThan(find);
  });

  it("10.1c clicking the Consult button calls choose once", () => {
    const { toolbar, root } = setupToolbar();
    const choose = jest.fn();
    toolbar.setConsult({ choose, windows });
    expect(choose).not.toHaveBeenCalled();
    consultButton(root)!.click();
    expect(choose).toHaveBeenCalledTimes(1);
  });

  it("10.1c the chips strip is empty while no window is open", () => {
    const { toolbar, root } = setupToolbar();
    toolbar.setConsult({ choose: jest.fn(), windows });
    expect(visibleChips(root)).toHaveLength(0);
  });

  it("10.1c lists one chip per open window with its title, in open order", () => {
    const { toolbar, root } = setupToolbar();
    toolbar.setConsult({ choose: jest.fn(), windows });
    windows.open({ kind: "paper", title: "Smith 2020" });
    windows.open({ kind: "code", title: "fit.py" });
    expect(chipTitles(root)).toEqual(["Smith 2020", "fit.py"]);
  });

  it("10.1c lists the windows already open when setConsult is called", () => {
    const { toolbar, root } = setupToolbar();
    windows.open({ kind: "paper", title: "Smith 2020" });
    toolbar.setConsult({ choose: jest.fn(), windows });
    expect(chipTitles(root)).toEqual(["Smith 2020"]);
  });

  it("10.1c a chip disappears when its window closes", async () => {
    const { toolbar, root } = setupToolbar();
    toolbar.setConsult({ choose: jest.fn(), windows });
    const smith = windows.open({ kind: "paper", title: "Smith 2020" });
    windows.open({ kind: "code", title: "fit.py" });
    await smith.close();
    await flush();
    expect(chipTitles(root)).toEqual(["fit.py"]);
  });

  it("10.1c a chip follows its window's renamed title", () => {
    const { toolbar, root } = setupToolbar();
    toolbar.setConsult({ choose: jest.fn(), windows });
    const win = windows.open({ kind: "paper", title: "Smith 2020" });
    win.title = "Smith 2021";
    expect(chipTitles(root)).toEqual(["Smith 2021"]);
  });

  it("10.1c a chip's close button closes its window", async () => {
    const { toolbar, root } = setupToolbar();
    toolbar.setConsult({ choose: jest.fn(), windows });
    const win = windows.open({ kind: "paper", title: "Smith 2020" });
    root.querySelector<HTMLButtonElement>('.ls-consult-chip button[aria-label="Close Smith 2020"]')!.click();
    await flush();
    expect(win.closed).toBe(true);
    expect(windows.list()).toHaveLength(0);
    expect(visibleChips(root)).toHaveLength(0);
  });

  it("10.1c clicking a chip's title brings its window into view", () => {
    const { toolbar, root } = setupToolbar();
    toolbar.setConsult({ choose: jest.fn(), windows });
    const win = windows.open({ kind: "paper", title: "Smith 2020" });
    const bring = jest.spyOn(win, "bringIntoView");
    root.querySelector<HTMLButtonElement>(".ls-consult-chip-main")!.click();
    expect(bring).toHaveBeenCalledTimes(1);
  });

  it("10.1c setConsult(undefined) hides the button and the chips again", () => {
    const { toolbar, root } = setupToolbar();
    toolbar.setConsult({ choose: jest.fn(), windows });
    windows.open({ kind: "paper", title: "Smith 2020" });
    toolbar.setConsult(undefined);
    const button = consultButton(root);
    expect(button === null || isHidden(button)).toBe(true);
    expect(visibleChips(root)).toHaveLength(0);
  });

  it("10.1c after setConsult(undefined) windows opened later show no chip", () => {
    const { toolbar, root } = setupToolbar();
    toolbar.setConsult({ choose: jest.fn(), windows });
    toolbar.setConsult(undefined);
    windows.open({ kind: "code", title: "fit.py" });
    expect(visibleChips(root)).toHaveLength(0);
  });

  it("10.1c setConsult can show the entry again after it was hidden", () => {
    const { toolbar, root } = setupToolbar();
    const choose = jest.fn();
    toolbar.setConsult({ choose, windows });
    toolbar.setConsult(undefined);
    windows.open({ kind: "code", title: "fit.py" });
    toolbar.setConsult({ choose, windows });
    expect(isHidden(consultButton(root)!)).toBe(false);
    expect(chipTitles(root)).toEqual(["fit.py"]);
    consultButton(root)!.click();
    expect(choose).toHaveBeenCalledTimes(1);
  });

  it("10.1c does not autohide while a consult window is open", () => {
    const { toolbar, container, root } = setupToolbar();
    toolbar.setConsult({ choose: jest.fn(), windows });
    windows.open({ kind: "paper", title: "Smith 2020" });
    container.dispatchEvent(new Event("wheel"));
    container.scrollTop = 600;
    container.dispatchEvent(new Event("scroll"));
    expect(root.classList.contains("rd-toolbar-hidden")).toBe(false);
  });

  it("10.1c still autohides on scroll with no consult window open (baseline for the pin)", () => {
    const { toolbar, container, root } = setupToolbar();
    toolbar.setConsult({ choose: jest.fn(), windows });
    container.dispatchEvent(new Event("wheel"));
    container.scrollTop = 600;
    container.dispatchEvent(new Event("scroll"));
    expect(root.classList.contains("rd-toolbar-hidden")).toBe(true);
  });
});

describe("renderConsultChips", () => {
  it("10.1c returns a strip with one chip per open window that follows opens and closes", async () => {
    windowsRoot = document.createElement("div");
    document.body.append(windowsRoot);
    windows = createFloatingWindows({ root: windowsRoot });
    const strip = renderConsultChips(windows);
    document.body.append(strip.el);
    expect(strip.el.querySelectorAll(".ls-consult-chip")).toHaveLength(0);
    const a = windows.open({ kind: "paper", title: "Smith 2020" });
    windows.open({ kind: "code", title: "fit.py" });
    expect(strip.el.querySelectorAll(".ls-consult-chip")).toHaveLength(2);
    await a.close();
    await flush();
    expect(strip.el.querySelectorAll(".ls-consult-chip")).toHaveLength(1);
    strip.destroy();
  });

  it("10.1c destroy stops the strip following the windows", () => {
    windowsRoot = document.createElement("div");
    document.body.append(windowsRoot);
    windows = createFloatingWindows({ root: windowsRoot });
    const strip = renderConsultChips(windows);
    strip.destroy();
    windows.open({ kind: "paper", title: "Smith 2020" });
    expect(strip.el.querySelectorAll(".ls-consult-chip")).toHaveLength(0);
  });
});
