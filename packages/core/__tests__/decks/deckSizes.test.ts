import {
  deckCanvasPx,
  formatDeckSize,
  isDeckSizeAllowed,
  listDeckSizePresets,
  parseDeckSize,
} from "../../src/decks/deckSizes";

describe("parseDeckSize and formatDeckSize", () => {
  it("1.2a parses px, mm and in sizes", () => {
    expect(parseDeckSize("1920x1080px")).toEqual({ w: 1920, h: 1080, unit: "px" });
    expect(parseDeckSize("841x1189mm")).toEqual({ w: 841, h: 1189, unit: "mm" });
    expect(parseDeckSize("36x48in")).toEqual({ w: 36, h: 48, unit: "in" });
    expect(parseDeckSize("100.5x200mm")).toEqual({ w: 100.5, h: 200, unit: "mm" });
    expect(parseDeckSize("23.4x33.1in")).toEqual({ w: 23.4, h: 33.1, unit: "in" });
  });

  it("1.2a rejects malformed sizes", () => {
    for (const text of [
      "",
      "1920x1080",
      "1920X1080px",
      "1920x1080PX",
      "1920 x 1080px",
      " 1920x1080px",
      "1920x1080px ",
      "01920x1080px",
      "1920.5x1080px",
      "0x1080px",
      "-1920x1080px",
      "100.55x200mm",
      "0x200mm",
      "1920x1080cm",
      "1920*1080px",
      "x1080px",
      "1920xpx",
    ]) {
      expect([text, parseDeckSize(text)]).toEqual([text, null]);
    }
  });

  it("1.2a does no range check in parseDeckSize", () => {
    expect(parseDeckSize("10x10px")).toEqual({ w: 10, h: 10, unit: "px" });
    expect(parseDeckSize("9000x5000mm")).toEqual({ w: 9000, h: 5000, unit: "mm" });
  });

  it("1.2a formats sizes with trailing zeros dropped", () => {
    expect(formatDeckSize({ w: 1920, h: 1080, unit: "px" })).toBe("1920x1080px");
    expect(formatDeckSize({ w: 841, h: 1189, unit: "mm" })).toBe("841x1189mm");
    expect(formatDeckSize({ w: 36, h: 48, unit: "in" })).toBe("36x48in");
    expect(formatDeckSize({ w: 100.5, h: 200, unit: "mm" })).toBe("100.5x200mm");
  });

  it("1.2a round-trips valid sizes through format and parse", () => {
    const sizes = [
      { w: 1920, h: 1080, unit: "px" as const },
      { w: 841, h: 1189, unit: "mm" as const },
      { w: 100.5, h: 200.1, unit: "mm" as const },
      { w: 36, h: 48, unit: "in" as const },
      { w: 23.4, h: 33.1, unit: "in" as const },
    ];
    for (const size of sizes) expect(parseDeckSize(formatDeckSize(size))).toEqual(size);
  });
});

describe("isDeckSizeAllowed", () => {
  it("1.2a allows talk px sizes within 320..7680 inclusive", () => {
    expect(isDeckSizeAllowed("talk", { w: 1920, h: 1080, unit: "px" })).toBe(true);
    expect(isDeckSizeAllowed("talk", { w: 320, h: 7680, unit: "px" })).toBe(true);
    expect(isDeckSizeAllowed("talk", { w: 319, h: 1080, unit: "px" })).toBe(false);
    expect(isDeckSizeAllowed("talk", { w: 1920, h: 7681, unit: "px" })).toBe(false);
  });

  it("1.2a refuses mm and in for talks", () => {
    expect(isDeckSizeAllowed("talk", { w: 841, h: 1189, unit: "mm" })).toBe(false);
    expect(isDeckSizeAllowed("talk", { w: 36, h: 48, unit: "in" })).toBe(false);
  });

  it("1.2a allows poster mm sizes within 100..2438.4 inclusive (spec 10.1)", () => {
    expect(isDeckSizeAllowed("poster", { w: 841, h: 1189, unit: "mm" })).toBe(true);
    expect(isDeckSizeAllowed("poster", { w: 100, h: 2438.4, unit: "mm" })).toBe(true);
    expect(isDeckSizeAllowed("poster", { w: 99.9, h: 1000, unit: "mm" })).toBe(false);
    expect(isDeckSizeAllowed("poster", { w: 1000, h: 2438.5, unit: "mm" })).toBe(false);
  });

  it("1.2a checks poster in sizes converted at 25.4 mm per inch", () => {
    expect(isDeckSizeAllowed("poster", { w: 36, h: 48, unit: "in" })).toBe(true);
    expect(isDeckSizeAllowed("poster", { w: 3.9, h: 48, unit: "in" })).toBe(false); // 99.06 mm
    expect(isDeckSizeAllowed("poster", { w: 4, h: 96, unit: "in" })).toBe(true); // 101.6 x 2438.4 mm
    expect(isDeckSizeAllowed("poster", { w: 36, h: 96.1, unit: "in" })).toBe(false); // 2440.94 mm
  });

  it("1.2a refuses px for posters", () => {
    expect(isDeckSizeAllowed("poster", { w: 1920, h: 1080, unit: "px" })).toBe(false);
  });
});

describe("deckCanvasPx", () => {
  it("1.2a keeps px as written", () => {
    expect(deckCanvasPx({ w: 1920, h: 1080, unit: "px" })).toEqual({ width: 1920, height: 1080 });
  });

  it("1.2a converts mm at 96 px per inch rounded to 2 decimals", () => {
    expect(deckCanvasPx({ w: 841, h: 1189, unit: "mm" })).toEqual({ width: 3178.58, height: 4493.86 });
    expect(deckCanvasPx({ w: 254, h: 127, unit: "mm" })).toEqual({ width: 960, height: 480 });
  });

  it("1.2a converts in at 96 px per inch", () => {
    expect(deckCanvasPx({ w: 36, h: 48, unit: "in" })).toEqual({ width: 3456, height: 4608 });
    expect(deckCanvasPx({ w: 23.4, h: 33.1, unit: "in" })).toEqual({ width: 2246.4, height: 3177.6 });
  });
});

describe("listDeckSizePresets", () => {
  it("1.2b lists the talk presets in order", () => {
    expect(listDeckSizePresets("talk")).toEqual([
      { id: "talk-16-9", label: "16:9", kind: "talk", size: { w: 1920, h: 1080, unit: "px" } },
      { id: "talk-4-3", label: "4:3", kind: "talk", size: { w: 1440, h: 1080, unit: "px" } },
      { id: "talk-16-10", label: "16:10", kind: "talk", size: { w: 1920, h: 1200, unit: "px" } },
    ]);
  });

  it("1.2b lists the poster presets in order", () => {
    const poster = (id: string, label: string, w: number, h: number, unit: "mm" | "in") => ({
      id,
      label,
      kind: "poster",
      size: { w, h, unit },
    });
    expect(listDeckSizePresets("poster")).toEqual([
      poster("a0-portrait", "A0 portrait", 841, 1189, "mm"),
      poster("a0-landscape", "A0 landscape", 1189, 841, "mm"),
      poster("a1-portrait", "A1 portrait", 594, 841, "mm"),
      poster("a1-landscape", "A1 landscape", 841, 594, "mm"),
      poster("a2-portrait", "A2 portrait", 420, 594, "mm"),
      poster("a2-landscape", "A2 landscape", 594, 420, "mm"),
      poster("arch-e-portrait", "ARCH E portrait", 36, 48, "in"),
      poster("arch-e-landscape", "ARCH E landscape", 48, 36, "in"),
      poster("poster-36x48in", "36 × 48 in", 36, 48, "in"),
      poster("poster-48x36in", "48 × 36 in", 48, 36, "in"),
    ]);
  });

  it("1.2b returns a fresh array each call", () => {
    const first = listDeckSizePresets("talk");
    first.pop();
    const second = listDeckSizePresets("talk");
    expect(second).toHaveLength(3);
    expect(second).not.toBe(first);
  });
});
