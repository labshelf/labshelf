/**
 * Spec 10c.1: the pure print check. checkPosterPrint turns measured text and image boxes (mm, from the page top left) into
 * lowDpi, margin and underfill issues; describePrintIssue gives their one-line texts.
 */
import {
  PRINT_MIN_DPI,
  PRINT_MIN_FILL,
  PRINT_SAFE_MARGIN_MM,
  checkPosterPrint,
  describePrintIssue,
  type PrintBox,
  type PrintImage,
  type PrintIssue,
  type PrintItem,
} from "../../src/decks/deckPrintCheck";

const A0 = { width: 841, height: 1189 };
const box = (left: number, top: number, width: number, height: number): PrintBox => ({ left, top, width, height });
const text = (block: string, index: number, b: PrintBox): PrintItem => ({ block, index, box: b });
const image = (block: string, index: number, b: PrintBox, pixelWidth: number, pixelHeight: number): PrintImage => ({
  block,
  index,
  box: b,
  pixelWidth,
  pixelHeight,
});
const ofKind = <K extends PrintIssue["kind"]>(issues: PrintIssue[], kind: K) =>
  issues.filter((i): i is Extract<PrintIssue, { kind: K }> => i.kind === kind);
/** A well-placed filler that fills most of A0 so that only the issue under test shows. */
const filler = (): PrintItem => text("filler", 99, box(20, 20, 800, 1149));

// --- 10c.1a -------------------------------------------------------------------------------------------------------------------------

describe("print check constants", () => {
  it("10c.1a exports 150 DPI, 10 mm and 0.7 fill", () => {
    expect(PRINT_MIN_DPI).toBe(150);
    expect(PRINT_SAFE_MARGIN_MM).toBe(10);
    expect(PRINT_MIN_FILL).toBe(0.7);
  });
});

describe("checkPosterPrint low DPI", () => {
  it("10c.1a flags an image below 150 DPI with the rounded DPI and its block, index and box", () => {
    // 100 px over 100 mm = 25.4 DPI
    const b = box(300, 300, 100, 100);
    const issues = checkPosterPrint({ page: A0, texts: [filler()], images: [image("fig", 3, b, 100, 100)] });
    expect(ofKind(issues, "lowDpi")).toEqual([{ kind: "lowDpi", block: "fig", index: 3, dpi: 25, box: b }]);
  });

  it("10c.1a does not flag an image at exactly 150 DPI", () => {
    // 150 px over 25.4 mm = 150 DPI
    const issues = checkPosterPrint({ page: A0, texts: [filler()], images: [image("fig", 0, box(300, 300, 25.4, 25.4), 150, 150)] });
    expect(ofKind(issues, "lowDpi")).toEqual([]);
  });

  it("10c.1a flags an image at 149 DPI", () => {
    const issues = checkPosterPrint({ page: A0, texts: [filler()], images: [image("fig", 0, box(300, 300, 25.4, 25.4), 149, 149)] });
    expect(ofKind(issues, "lowDpi").map((i) => i.dpi)).toEqual([149]);
  });

  it("10c.1a does not flag a sharp image", () => {
    const issues = checkPosterPrint({ page: A0, texts: [filler()], images: [image("fig", 0, box(300, 300, 100, 100), 1000, 1000)] });
    expect(ofKind(issues, "lowDpi")).toEqual([]);
  });

  it("10c.1a takes the lower of the horizontal and vertical DPI", () => {
    // 3000 px over 254 mm = 300 DPI wide; 300 px over 254 mm = 30 DPI high
    const issues = checkPosterPrint({ page: A0, texts: [filler()], images: [image("fig", 0, box(300, 300, 254, 254), 3000, 300)] });
    expect(ofKind(issues, "lowDpi").map((i) => i.dpi)).toEqual([30]);
  });

  it("10c.1a lists the low DPI issues in input image order and skips the sharp ones between them", () => {
    const issues = checkPosterPrint({
      page: A0,
      texts: [filler()],
      images: [
        image("a", 0, box(300, 300, 100, 100), 100, 100),
        image("b", 1, box(300, 500, 100, 100), 2000, 2000),
        image("c", 2, box(300, 700, 100, 100), 200, 200),
      ],
    });
    expect(ofKind(issues, "lowDpi").map((i) => [i.block, i.dpi])).toEqual([
      ["a", 25],
      ["c", 51],
    ]);
  });

  it("10c.1a skips images with zero, negative or non-finite sizes and never throws", () => {
    const bad = [
      image("a", 0, box(300, 300, 0, 100), 100, 100),
      image("b", 1, box(300, 300, 100, -5), 100, 100),
      image("c", 2, box(300, 300, 100, 100), 0, 100),
      image("d", 3, box(300, 300, 100, 100), 100, Number.NaN),
      image("e", 4, box(300, 300, Number.POSITIVE_INFINITY, 100), 100, 100),
    ];
    let issues: PrintIssue[] = [];
    expect(() => {
      issues = checkPosterPrint({ page: A0, texts: [filler()], images: bad });
    }).not.toThrow();
    expect(ofKind(issues, "lowDpi")).toEqual([]);
  });

  it("10c.1a returns no issues for an empty page", () => {
    expect(checkPosterPrint({ page: A0, texts: [], images: [] })).toEqual([]);
  });
});

// --- 10c.1b -------------------------------------------------------------------------------------------------------------------------

describe("checkPosterPrint margins", () => {
  it("10c.1b gives one issue for one item near an edge, with count 1 and its distance", () => {
    const b = box(4, 300, 100, 50);
    const issues = checkPosterPrint({ page: A0, texts: [filler(), text("t", 7, b)], images: [] });
    expect(ofKind(issues, "margin")).toEqual([{ kind: "margin", edge: "left", count: 1, distance: 4, block: "t", index: 7, box: b }]);
  });

  it("10c.1b measures each of the four edges and lists them top, right, bottom, left", () => {
    const issues = checkPosterPrint({
      page: A0,
      texts: [
        filler(),
        text("L", 0, box(6, 500, 100, 50)), // left 6
        text("B", 1, box(300, 1100, 100, 87)), // bottom 1189 - 1187 = 2
        text("R", 2, box(700, 300, 138, 50)), // right 841 - 838 = 3
        text("T", 3, box(100, 4, 100, 50)), // top 4
      ],
      images: [],
    });
    expect(ofKind(issues, "margin").map((i) => [i.edge, i.distance, i.block])).toEqual([
      ["top", 4, "T"],
      ["right", 3, "R"],
      ["bottom", 2, "B"],
      ["left", 6, "L"],
    ]);
  });

  it("10c.1b counts the items near an edge and reports the closest distance rounded to one decimal", () => {
    const issues = checkPosterPrint({
      page: A0,
      texts: [filler(), text("far", 0, box(8, 300, 100, 50)), text("near", 1, box(2.34, 400, 100, 50))],
      images: [],
    });
    const left = ofKind(issues, "margin").filter((i) => i.edge === "left");
    expect(left).toHaveLength(1);
    expect(left[0]!.count).toBe(2);
    expect(left[0]!.distance).toBe(2.3);
    expect(left[0]!.block).toBe("near");
    expect(left[0]!.index).toBe(1);
    expect(left[0]!.box).toEqual(box(2.34, 400, 100, 50));
  });

  it("10c.1b reports a negative distance for an item that crosses the edge", () => {
    const issues = checkPosterPrint({ page: A0, texts: [filler(), text("t", 0, box(-3, 300, 100, 50))], images: [] });
    expect(ofKind(issues, "margin").map((i) => [i.edge, i.distance])).toEqual([["left", -3]]);
  });

  it("10c.1b treats exactly 10 mm as inside the safe margin and gives no issue", () => {
    const issues = checkPosterPrint({ page: A0, texts: [filler(), text("t", 0, box(10, 300, 100, 50))], images: [] });
    expect(ofKind(issues, "margin")).toEqual([]);
  });

  it("10c.1b counts images as well as texts", () => {
    const issues = checkPosterPrint({
      page: A0,
      texts: [filler(), text("t", 0, box(5, 300, 100, 50))],
      images: [image("fig", 1, box(3, 500, 100, 100), 2000, 2000)],
    });
    const left = ofKind(issues, "margin").filter((i) => i.edge === "left");
    expect(left).toHaveLength(1);
    expect(left[0]!.count).toBe(2);
    expect(left[0]!.distance).toBe(3);
    expect(left[0]!.block).toBe("fig");
  });

  it("10c.1b picks the first item in input order on a tie, texts before images", () => {
    const issues = checkPosterPrint({
      page: A0,
      texts: [filler(), text("first", 0, box(5, 300, 100, 50)), text("second", 1, box(5, 400, 100, 50))],
      images: [image("fig", 0, box(5, 500, 100, 100), 2000, 2000)],
    });
    const left = ofKind(issues, "margin").filter((i) => i.edge === "left");
    expect(left[0]!.count).toBe(3);
    expect(left[0]!.block).toBe("first");
  });

  it("10c.1b ignores a full-width band, even one touching the top and bottom edges of the page", () => {
    // width >= 90% of 841 = 756.9
    const issues = checkPosterPrint({ page: A0, texts: [filler(), text("band", 0, box(0, 0, 841, 120))], images: [] });
    expect(ofKind(issues, "margin")).toEqual([]);
  });

  it("10c.1b ignores a full-height band in the margin check", () => {
    // height >= 90% of 1189 = 1070.1
    const issues = checkPosterPrint({ page: A0, texts: [filler(), text("side", 0, box(0, 0, 100, 1189))], images: [] });
    expect(ofKind(issues, "margin")).toEqual([]);
  });

  it("10c.1b keeps an item just under the 90% band size in the margin check", () => {
    const issues = checkPosterPrint({ page: A0, texts: [filler(), text("wide", 0, box(2, 300, 750, 50))], images: [] });
    expect(ofKind(issues, "margin").map((i) => i.edge)).toEqual(["left"]);
  });

  it("10c.1b ignores a background image in the margin check", () => {
    const issues = checkPosterPrint({ page: A0, texts: [filler()], images: [image("bg", 0, box(0, 0, 841, 1189), 5000, 7000)] });
    expect(ofKind(issues, "margin")).toEqual([]);
  });

  it("10c.1b skips items with non-finite or non-positive sizes in the margin check and never throws", () => {
    let issues: PrintIssue[] = [];
    expect(() => {
      issues = checkPosterPrint({
        page: A0,
        texts: [filler(), text("nan", 0, box(Number.NaN, 300, 100, 50)), text("zero", 1, box(2, 300, 0, 50))],
        images: [],
      });
    }).not.toThrow();
    expect(ofKind(issues, "margin")).toEqual([]);
  });
});

// --- 10c.1c -------------------------------------------------------------------------------------------------------------------------

describe("checkPosterPrint underfill", () => {
  it("10c.1c flags content that fills only the top third of an A0 page: height, bottom empty", () => {
    const issues = checkPosterPrint({
      page: A0,
      texts: [text("title", 0, box(70, 20, 700, 100)), text("body", 1, box(70, 150, 700, 246))],
      images: [],
    });
    expect(ofKind(issues, "underfill")).toEqual([
      { kind: "underfill", dimension: "height", filled: 0.32, empty: "bottom", box: box(70, 20, 700, 376) },
    ]);
  });

  it("10c.1c gives nothing for a filled page", () => {
    const issues = checkPosterPrint({ page: A0, texts: [filler()], images: [] });
    expect(ofKind(issues, "underfill")).toEqual([]);
  });

  it("10c.1c gives nothing for an empty page", () => {
    expect(ofKind(checkPosterPrint({ page: A0, texts: [], images: [] }), "underfill")).toEqual([]);
  });

  it("10c.1c reports the top as empty when the content sits at the bottom", () => {
    const issues = checkPosterPrint({ page: A0, texts: [text("t", 0, box(70, 800, 700, 369))], images: [] });
    const u = ofKind(issues, "underfill");
    expect(u).toHaveLength(1);
    expect(u[0]!.dimension).toBe("height");
    expect(u[0]!.empty).toBe("top");
  });

  it("10c.1c flags a narrow column of content as underfill of the width with the right empty", () => {
    const issues = checkPosterPrint({ page: A0, texts: [text("t", 0, box(20, 20, 300, 1149))], images: [] });
    expect(ofKind(issues, "underfill")).toEqual([
      { kind: "underfill", dimension: "width", filled: 0.36, empty: "right", box: box(20, 20, 300, 1149) },
    ]);
  });

  it("10c.1c reports the left as empty when the content sits at the right", () => {
    const issues = checkPosterPrint({ page: A0, texts: [text("t", 0, box(500, 20, 321, 1149))], images: [] });
    const u = ofKind(issues, "underfill");
    expect(u).toHaveLength(1);
    expect(u[0]!.dimension).toBe("width");
    expect(u[0]!.empty).toBe("left");
  });

  it("10c.1c does not flag a fill of exactly 0.7", () => {
    const issues = checkPosterPrint({ page: { width: 1000, height: 1000 }, texts: [text("t", 0, box(0, 0, 700, 1000))], images: [] });
    expect(ofKind(issues, "underfill")).toEqual([]);
  });

  it("10c.1c picks the height when both fills are equal, with the bottom empty on a tie of the gaps", () => {
    const issues = checkPosterPrint({ page: { width: 1000, height: 1000 }, texts: [text("t", 0, box(250, 250, 500, 500))], images: [] });
    expect(ofKind(issues, "underfill")).toEqual([
      { kind: "underfill", dimension: "height", filled: 0.5, empty: "bottom", box: box(250, 250, 500, 500) },
    ]);
  });

  it("10c.1c reports the right empty on a tie of the left and right gaps", () => {
    const issues = checkPosterPrint({ page: { width: 1000, height: 1000 }, texts: [text("t", 0, box(250, 0, 500, 1000))], images: [] });
    expect(ofKind(issues, "underfill")).toEqual([
      { kind: "underfill", dimension: "width", filled: 0.5, empty: "right", box: box(250, 0, 500, 1000) },
    ]);
  });

  it("10c.1c leaves a background image out of the union, so the content on it decides", () => {
    const issues = checkPosterPrint({
      page: A0,
      texts: [text("t", 0, box(70, 20, 700, 300))],
      images: [image("bg", 0, box(0, 0, 841, 1189), 5000, 7000)],
    });
    const u = ofKind(issues, "underfill");
    expect(u).toHaveLength(1);
    expect(u[0]!.box).toEqual(box(70, 20, 700, 300));
  });

  it("10c.1c gives no underfill when there is only a background", () => {
    const issues = checkPosterPrint({ page: A0, texts: [], images: [image("bg", 0, box(0, 0, 841, 1189), 5000, 7000)] });
    expect(ofKind(issues, "underfill")).toEqual([]);
  });

  it("10c.1c counts a band in the union (only backgrounds are left out)", () => {
    // a full-width header alone fills the whole width but only 100/1189 of the height
    const issues = checkPosterPrint({ page: A0, texts: [text("band", 0, box(0, 0, 841, 100))], images: [] });
    const u = ofKind(issues, "underfill");
    expect(u).toHaveLength(1);
    expect(u[0]!.dimension).toBe("height");
    expect(u[0]!.empty).toBe("bottom");
  });

  it("10c.1c gives at most one underfill issue", () => {
    const issues = checkPosterPrint({
      page: A0,
      texts: [text("a", 0, box(70, 20, 100, 100)), text("b", 1, box(500, 200, 100, 100))],
      images: [],
    });
    expect(ofKind(issues, "underfill")).toHaveLength(1);
  });
});

// --- order ----------------------------------------------------------------------------------------------------------------------------

describe("checkPosterPrint order", () => {
  it("10c.1a puts lowDpi issues first, then margins in edge order, then the underfill", () => {
    const issues = checkPosterPrint({
      page: { width: 1000, height: 1000 },
      texts: [text("t", 0, box(300, 5, 100, 20))],
      images: [image("i1", 0, box(5, 200, 100, 100), 100, 100), image("i2", 1, box(500, 200, 100, 100), 200, 200)],
    });
    expect(issues.map((i) => (i.kind === "margin" ? `margin:${i.edge}` : i.kind))).toEqual([
      "lowDpi",
      "lowDpi",
      "margin:top",
      "margin:left",
      "underfill",
    ]);
    expect(ofKind(issues, "lowDpi").map((i) => i.block)).toEqual(["i1", "i2"]);
  });
});

// --- 10c.1d -------------------------------------------------------------------------------------------------------------------------

describe("describePrintIssue", () => {
  const b = box(0, 0, 10, 10);

  it("10c.1d describes a low DPI image", () => {
    expect(describePrintIssue({ kind: "lowDpi", block: "fig", index: 0, dpi: 96, box: b })).toBe("Image at 96 DPI at print size (needs 150)");
  });

  it("10c.1d describes one item in the margin", () => {
    expect(describePrintIssue({ kind: "margin", edge: "left", count: 1, distance: 4.5, block: "t", index: 0, box: b })).toBe(
      "1 item within 10 mm of the left edge, closest 4.5 mm",
    );
  });

  it("10c.1d describes several items in the margin with the distance as rounded", () => {
    expect(describePrintIssue({ kind: "margin", edge: "top", count: 3, distance: 4, block: "t", index: 0, box: b })).toBe(
      "3 items within 10 mm of the top edge, closest 4 mm",
    );
  });

  it("10c.1d describes a negative distance", () => {
    expect(describePrintIssue({ kind: "margin", edge: "bottom", count: 2, distance: -2.3, block: "t", index: 0, box: b })).toBe(
      "2 items within 10 mm of the bottom edge, closest -2.3 mm",
    );
  });

  it("10c.1d describes an underfilled height", () => {
    expect(describePrintIssue({ kind: "underfill", dimension: "height", filled: 0.33, empty: "bottom", box: b })).toBe(
      "Content fills 33% of the page height; the bottom is empty",
    );
  });

  it("10c.1d describes an underfilled width", () => {
    expect(describePrintIssue({ kind: "underfill", dimension: "width", filled: 0.5, empty: "right", box: b })).toBe(
      "Content fills 50% of the page width; the right is empty",
    );
  });
});

// --- A10 ----------------------------------------------------------------------------------------------------------------------------

describe("print check core", () => {
  it("A10 finds a low DPI image, a margin intruder and underfill on one poster, and describes them", () => {
    const issues = checkPosterPrint({
      page: A0,
      texts: [text("title", 0, box(5, 20, 700, 100))],
      images: [image("fig", 1, box(300, 150, 100, 100), 100, 100)],
    });
    expect(issues.map((i) => i.kind)).toEqual(["lowDpi", "margin", "underfill"]);
    expect(issues.map(describePrintIssue)).toEqual([
      "Image at 25 DPI at print size (needs 150)",
      "1 item within 10 mm of the left edge, closest 5 mm",
      "Content fills 19% of the page height; the bottom is empty",
    ]);
  });

  it("A10 finds nothing on a sharp, well-placed, full poster", () => {
    const issues = checkPosterPrint({
      page: A0,
      texts: [text("body", 0, box(20, 20, 800, 1000))],
      images: [image("fig", 0, box(100, 100, 100, 100), 2000, 2000)],
    });
    expect(issues).toEqual([]);
  });
});
