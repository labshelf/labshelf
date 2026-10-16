/**
 * @jest-environment jsdom
 */
// Tests the reader theme controller: the effective theme reaches the document and its listeners from any source.
import { ThemeController } from "../../../../src/reader/dom/chrome/theme";

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
});
