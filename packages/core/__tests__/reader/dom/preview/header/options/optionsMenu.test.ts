/**
 * @jest-environment jsdom
 */
// Tests the header options menu: hidden without options, Typst has no engines, LaTeX lists four, items post their messages.
import { mountOptionsMenu } from "../../../../../../src/reader/dom/preview/header/options/index";
import { closeMenu } from "../../../../../../src/ui/dom/index";
import type { BuildOptions, PreviewRoots } from "../../../../../../src/reader/index";

const roots = (options?: BuildOptions): PreviewRoots => ({
  main: "a", focused: "a", shown: "a", roots: [], ...(options && { options }),
});

function setup() {
  const post = jest.fn();
  const slot = document.createElement("span");
  slot.hidden = true;
  document.body.replaceChildren(slot);
  const menu = mountOptionsMenu(slot, { post });
  const button = () => slot.querySelector<HTMLButtonElement>("button")!;
  const items = () => [...document.querySelectorAll<HTMLButtonElement>(".ls-menu-item")];
  const item = (text: string) => items().find((b) => b.textContent?.includes(text))!;
  return { menu, post, slot, button, items, item };
}

describe("mountOptionsMenu", () => {
  afterEach(() => { closeMenu(); document.body.replaceChildren(); });

  it("keeps the slot hidden while the roots carry no options", () => {
    const t = setup();
    t.menu.setRoots(roots());
    expect(t.slot.hidden).toBe(true);
    t.menu.setRoots(roots({ autoCompile: true }));
    expect(t.slot.hidden).toBe(false);
    t.menu.setRoots(roots());
    expect(t.slot.hidden).toBe(true);
  });

  it("labels the gear button and announces the menu", () => {
    const t = setup();
    expect(t.button().getAttribute("aria-label")).toBe("Build options");
    expect(t.button().getAttribute("aria-haspopup")).toBe("menu");
    expect(t.button().getAttribute("aria-expanded")).toBe("false");
  });

  it("shows only Auto compile for a Typst root, checked from the setting", () => {
    const t = setup();
    t.menu.setRoots(roots({ autoCompile: false }));
    t.button().click();
    expect(t.items().map((b) => b.textContent)).toEqual(["Auto compile on save"]);
    expect(t.item("Auto compile on save").getAttribute("role")).toBe("menuitemcheckbox");
    expect(t.item("Auto compile on save").getAttribute("aria-checked")).toBe("false");
    expect(t.button().getAttribute("aria-expanded")).toBe("true");
  });

  it("lists the four engines for a LaTeX root with the current one checked", () => {
    const t = setup();
    t.menu.setRoots(roots({ autoCompile: true, engine: "xelatex" }));
    t.button().click();
    expect(document.querySelectorAll(".ls-menu-sep")).toHaveLength(1);
    const engines = t.items().slice(1);
    expect(engines.map((b) => b.textContent)).toEqual(["XeLaTeX (Tectonic)", "XeLaTeX", "pdfLaTeX", "LuaLaTeX"]);
    expect(engines.map((b) => b.getAttribute("role"))).toEqual(Array(4).fill("menuitemradio"));
    expect(engines.map((b) => b.getAttribute("aria-checked"))).toEqual(["false", "true", "false", "false"]);
  });

  it("lists the four engines with none checked for a LaTeX root that has not chosen one", () => {
    const t = setup();
    t.menu.setRoots(roots({ autoCompile: true, engine: null }));
    t.button().click();
    const engines = t.items().slice(1);
    expect(engines.map((b) => b.getAttribute("role"))).toEqual(Array(4).fill("menuitemradio"));
    expect(engines.map((b) => b.getAttribute("aria-checked"))).toEqual(Array(4).fill("false"));
  });

  it("posts setAutoCompile with the inverse of the current value", () => {
    const t = setup();
    t.menu.setRoots(roots({ autoCompile: true }));
    t.button().click();
    t.item("Auto compile on save").click();
    expect(t.post).toHaveBeenCalledWith({ command: "setAutoCompile", on: false });
    expect(document.querySelector(".ls-menu")).toBeNull();
  });

  it("posts setEngine with the picked engine", () => {
    const t = setup();
    t.menu.setRoots(roots({ autoCompile: true, engine: "tectonic" }));
    t.button().click();
    t.item("LuaLaTeX").click();
    expect(t.post).toHaveBeenCalledWith({ command: "setEngine", engine: "lualatex" });
  });

  it("closes on Escape, collapses the button and returns focus to it", () => {
    const t = setup();
    t.menu.setRoots(roots({ autoCompile: true }));
    t.button().click();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.querySelector(".ls-menu")).toBeNull();
    expect(t.button().getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(t.button());
  });
});
