import { ANNOTATION_COLORS } from "@labshelf/core";

type Theme = typeof import("../../src/ui/theme.js").theme;

function loadTheme(noColor: boolean): Theme {
  const saved = process.env["NO_COLOR"];
  if (noColor) { process.env["NO_COLOR"] = "1"; } else { delete process.env["NO_COLOR"]; }
  try {
    let loaded!: Theme;
    jest.isolateModules(() => {
      loaded = (require("../../src/ui/theme.js") as typeof import("../../src/ui/theme.js")).theme;
    });
    return loaded;
  } finally {
    if (saved === undefined) { delete process.env["NO_COLOR"]; } else { process.env["NO_COLOR"] = saved; }
  }
}

describe("theme", () => {
  const theme = loadTheme(false);

  it("gives every core annotation colour a coloured style", () => {
    for (const name of ANNOTATION_COLORS) {
      expect(theme.annotation[name]?.fg).toEqual(expect.any(Number));
    }
  });

  it("maps annotation colours to their ANSI indexes", () => {
    expect(theme.annotation).toEqual({
      yellow: { fg: 3 }, green: { fg: 2 }, blue: { fg: 4 }, red: { fg: 1 }, pink: { fg: 5 },
    });
  });

  it("maps paper status roles to their ANSI styles", () => {
    expect(theme.status).toEqual({
      unread: { dim: true },
      reading: { fg: 3, bold: true },
      done: { fg: 2 },
    });
  });

  it("maps the shared roles to their ANSI indexes", () => {
    expect(theme.error).toEqual({ fg: 1, bold: true });
    expect(theme.warn).toEqual({ fg: 3 });
    expect(theme.link).toEqual({ fg: 4, underline: true });
    expect(theme.brand).toEqual({ fg: 4, bold: true });
  });

  it("drops colours but keeps attributes under NO_COLOR", () => {
    const plain = loadTheme(true);
    expect(plain.annotation["yellow"]).toEqual({});
    expect(plain.status.reading).toEqual({ bold: true });
    expect(plain.mode["NORMAL"]).toEqual({ reverse: true, bold: true });
    expect(plain.link).toEqual({ underline: true });
  });
});
