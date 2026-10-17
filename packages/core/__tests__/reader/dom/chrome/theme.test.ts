/**
 * @jest-environment jsdom
 */
// Tests the reader theme controller: the effective theme reaches the document and its listeners from any source.
import { ThemeController } from "../../../../src/reader/dom/chrome/theme";
import { presetFor } from "../../../../src/reader/index";

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
    expect(theme.colors.bg).toBe(presetFor("light").bg);
    expect(container.style.background).toBe("");
  });

  it("switches the locked preset when locked again", () => {
    const theme = new ThemeController(document.createElement("div"), "auto", "light");
    theme.lockPages("light");
    theme.lockPages("dark");

    expect(theme.pageTheme).toBe("dark");
    expect(theme.colors.bg).toBe(presetFor("dark").bg);
    expect(document.documentElement.dataset["pdfPages"]).toBe("dark");
  });
});
