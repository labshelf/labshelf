/**
 * @jest-environment jsdom
 */
// Tests the reader theme controller: the effective theme reaches the document and its listeners from any source.
import { ThemeController } from "../../../src/reader/dom/theme";
import { findPagePreset } from "../../../src/reader/index";

describe("ThemeController", () => {
  it("tells effective-theme listeners about every applied theme, init included", () => {
    const theme = new ThemeController(document.createElement("div"), "auto", "dark");
    const seen: string[] = [];
    theme.onEffectiveChange((effective) => seen.push(effective));

    theme.apply("auto", "light");
    theme.apply("dark", "dark");

    expect(seen).toEqual(["light", "dark"]);
    expect(document.documentElement.dataset["pdfTheme"]).toBe("dark");
  });

  it("keeps the effective theme when a message carries only a preference", () => {
    const theme = new ThemeController(document.createElement("div"), "auto", "light");
    const listener = jest.fn();
    theme.onEffectiveChange(listener);

    theme.apply("dark", undefined);

    expect(listener).not.toHaveBeenCalled();
    expect(theme.effective).toBe("light");
  });

  it("on a desk, draws the pages with the theme and leaves the area around them to the stylesheet", () => {
    const container = document.createElement("div");
    const theme = new ThemeController(container, "auto", "light", true);

    theme.apply("sepia", "sepia");

    expect(document.documentElement.dataset["pdfTheme"]).toBe("sepia");
    expect(document.documentElement.dataset["pdfPages"]).toBe("sepia");
    expect(theme.pageTheme).toBe("sepia");
    expect(theme.colors.bg).toBe(findPagePreset("sepia").bg);
    expect(container.style.background).toBe("");
  });

  it("on a desk, marks a custom theme's sheet as custom", () => {
    const theme = new ThemeController(document.createElement("div"), "auto", "light", true);
    theme.apply("custom:a", "dark", { id: "a", name: "Mine", page: "#faf6ee", ink: "#4a3728", updatedAt: "2026-01-01T00:00:00Z" });
    expect(document.documentElement.dataset["pdfPages"]).toBe("custom");
    expect(theme.colors.bg).toBe("#faf6ee");
  });

  it("adapts link ink to the page as the theme changes", () => {
    const container = document.createElement("div");
    const theme = new ThemeController(container, "dark", "dark");
    expect(container.dataset["pdfLinkTone"]).toBe("light");

    theme.apply("light", "light");
    expect(container.dataset["pdfLinkTone"]).toBe("dark");
  });

  it("adapts link ink to custom page colours", () => {
    const container = document.createElement("div");
    const theme = new ThemeController(container, "dark", "dark");
    theme.applyPageColors("#faf6ee", "#4a3728");
    expect(container.dataset["pdfLinkTone"]).toBe("dark");
    theme.applyPageColors("#18232b", "#e7edf0");
    expect(container.dataset["pdfLinkTone"]).toBe("light");
  });
});


describe("page recolouring", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("invalidates raster and detail canvases before drawing with the selected colours", () => {
    const page = { pageColors: null, reset: jest.fn() };
    const viewer = { pageColors: null, pagesCount: 1, getPageView: () => page, update: jest.fn(), refresh: jest.fn() };
    const theme = new ThemeController(document.createElement("div"), "light", "light");
    theme.attach(viewer as unknown as Parameters<ThemeController["attach"]>[0]);
    theme.apply("dark", "dark");
    jest.runAllTimers();
    expect(page.pageColors).toEqual(theme.pageColors);
    expect(page.reset).toHaveBeenCalledTimes(1);
    expect(viewer.update).toHaveBeenCalledTimes(1);
  });

  it("recolours the current document when a build replaces it during the debounce", () => {
    const first = { pageColors: null, reset: jest.fn() };
    const replacement = { pageColors: null, reset: jest.fn() };
    let page = first;
    const viewer = { pageColors: null, pagesCount: 1, getPageView: () => page, update: jest.fn(), refresh: jest.fn() };
    const theme = new ThemeController(document.createElement("div"), "light", "light");
    theme.attach(viewer as unknown as Parameters<ThemeController["attach"]>[0]);
    theme.apply("dark", "dark");
    page = replacement;
    jest.runAllTimers();
    expect(first.reset).not.toHaveBeenCalled();
    expect(replacement.pageColors).toEqual(theme.pageColors);
    expect(replacement.reset).toHaveBeenCalledTimes(1);
  });
});
