import { nextThemePref, resolveTheme } from "../../../src/ui/dom/theme";

describe("nextThemePref", () => {
  it("cycles auto, light, dark, then back to auto", () => {
    expect(nextThemePref("auto")).toBe("light");
    expect(nextThemePref("light")).toBe("dark");
    expect(nextThemePref("dark")).toBe("auto");
  });
});

describe("resolveTheme", () => {
  const g = globalThis as unknown as { window?: unknown };
  const original = g.window;
  afterEach(() => { g.window = original; });

  function stubOsScheme(light: boolean): void {
    g.window = { matchMedia: (q: string) => ({ matches: q.includes("light") && light }) };
  }

  it("returns a pinned preference without reading the OS", () => {
    g.window = undefined;
    expect(resolveTheme("light")).toBe("light");
    expect(resolveTheme("dark")).toBe("dark");
  });
  it("follows the OS colour scheme for auto", () => {
    stubOsScheme(true);
    expect(resolveTheme("auto")).toBe("light");
    stubOsScheme(false);
    expect(resolveTheme("auto")).toBe("dark");
  });
});
