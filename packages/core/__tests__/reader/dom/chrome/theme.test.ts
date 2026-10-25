/**
 * @jest-environment jsdom
 */
// Tests the reader theme controller: the effective theme reaches the document and its listeners from any source.
import { ThemeController } from "../../../../src/reader/dom/chrome/index";
import { findPagePreset } from "../../../../src/reader/index";

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

  it("keeps the locked page preset while the chrome follows the effective theme", () => {
    const container = document.createElement("div");
    const theme = new ThemeController(container, "auto", "dark");
    theme.lockPages("light");

    theme.apply("auto", "dark");

    expect(document.documentElement.dataset["pdfTheme"]).toBe("dark");
    expect(document.documentElement.dataset["pdfPages"]).toBe("light");
    expect(theme.pageTheme).toBe("light");
    expect(theme.colors.bg).toBe(findPagePreset("light").bg);
    expect(container.style.background).toBe("");
  });

  it("switches the locked preset when locked again", () => {
    const theme = new ThemeController(document.createElement("div"), "auto", "light");
    theme.lockPages("light");
    theme.lockPages("dark");

    expect(theme.pageTheme).toBe("dark");
    expect(theme.colors.bg).toBe(findPagePreset("dark").bg);
    expect(document.documentElement.dataset["pdfPages"]).toBe("dark");
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
    theme.lockPages("dark");
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
    theme.lockPages("dark");
    page = replacement;
    jest.runAllTimers();
    expect(first.reset).not.toHaveBeenCalled();
    expect(replacement.pageColors).toEqual(theme.pageColors);
    expect(replacement.reset).toHaveBeenCalledTimes(1);
  });
});
