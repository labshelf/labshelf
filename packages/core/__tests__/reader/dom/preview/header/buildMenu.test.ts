/**
 * @jest-environment jsdom
 */
// Tests the header options menu: hidden without options, Typst shows the compile modes, LaTeX adds engines and error handling, items post their messages.
import { mountOptionsMenu } from "../../../../../src/reader/dom/preview/header/index";
import { closeMenu } from "../../../../../src/ui/dom/index";
import type { BuildOptions, PreviewRoots } from "../../../../../src/reader/index";

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
    t.menu.setRoots(roots({ autoCompile: "save" }));
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

  it("shows only the three compile modes for a Typst root, the current one checked", () => {
    const t = setup();
    t.menu.setRoots(roots({ autoCompile: "off" }));
    t.button().click();
    expect(t.items().map((b) => b.textContent)).toEqual(["Auto compile", "Compile on save", "Compile manually"]);
    expect(t.items().map((b) => b.getAttribute("role"))).toEqual(Array(3).fill("menuitemradio"));
    expect(t.items().map((b) => b.getAttribute("aria-checked"))).toEqual(["false", "false", "true"]);
    expect(document.querySelectorAll(".ls-menu-sep")).toHaveLength(0);
    expect(t.button().getAttribute("aria-expanded")).toBe("true");
  });

  it("lists modes, engines and error handling for a LaTeX root with the current choices checked", () => {
    const t = setup();
    t.menu.setRoots(roots({ autoCompile: "typing", engine: "xelatex", haltOnError: true }));
    t.button().click();
    expect(document.querySelectorAll(".ls-menu-sep")).toHaveLength(2);
    expect(t.items().map((b) => b.textContent)).toEqual([
      "Auto compile", "Compile on save", "Compile manually",
      "pdfLaTeX", "XeLaTeX", "LuaLaTeX",
      "Stop on first error", "Try to compile despite errors",
    ]);
    expect(t.items().map((b) => b.getAttribute("role"))).toEqual(Array(8).fill("menuitemradio"));
    expect(t.items().map((b) => b.getAttribute("aria-checked"))).toEqual(
      ["true", "false", "false", "false", "true", "false", "true", "false"],
    );
  });

  it("checks no engine and continues despite errors for a LaTeX root without those choices", () => {
    const t = setup();
    t.menu.setRoots(roots({ autoCompile: "save", engine: null }));
    t.button().click();
    expect(t.items().slice(3).map((b) => b.getAttribute("aria-checked"))).toEqual(
      ["false", "false", "false", "false", "true"],
    );
  });

  it("posts setAutoCompile with the picked mode", () => {
    const t = setup();
    t.menu.setRoots(roots({ autoCompile: "save" }));
    t.button().click();
    t.item("Auto compile").click();
    expect(t.post).toHaveBeenCalledWith({ command: "setAutoCompile", mode: "typing" });
    expect(document.querySelector(".ls-menu")).toBeNull();
  });

  it("posts setHaltOnError with the picked behaviour", () => {
    const t = setup();
    t.menu.setRoots(roots({ autoCompile: "save", engine: "pdflatex", haltOnError: false }));
    t.button().click();
    t.item("Stop on first error").click();
    expect(t.post).toHaveBeenCalledWith({ command: "setHaltOnError", on: true });
    t.button().click();
    t.item("Try to compile despite errors").click();
    expect(t.post).toHaveBeenLastCalledWith({ command: "setHaltOnError", on: false });
  });

  it("posts setEngine with the picked engine", () => {
    const t = setup();
    t.menu.setRoots(roots({ autoCompile: "save", engine: "xelatex" }));
    t.button().click();
    t.item("LuaLaTeX").click();
    expect(t.post).toHaveBeenCalledWith({ command: "setEngine", engine: "lualatex" });
  });

  it("closes on Escape, collapses the button and returns focus to it", () => {
    const t = setup();
    t.menu.setRoots(roots({ autoCompile: "save" }));
    t.button().click();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.querySelector(".ls-menu")).toBeNull();
    expect(t.button().getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(t.button());
  });
});
