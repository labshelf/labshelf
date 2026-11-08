/**
 * Spec 10c.1: pdfImagePlacements walks a pdf.js operator list and returns each painted image as a box in PDF points
 * from the page top left, with its pixel size.
 */
import { pdfImagePlacements, type PdfOperatorCodes } from "../../src/decks/deckPrintCheckPdf";

const codes: PdfOperatorCodes = {
  save: 1,
  restore: 2,
  transform: 3,
  paintFormXObjectBegin: 4,
  paintFormXObjectEnd: 5,
  paintImageXObject: 6,
  paintInlineImageXObject: 7,
};
const OTHER = 99;

const list = (ops: Array<[number, unknown]>) => ({ fnArray: ops.map((o) => o[0]), argsArray: ops.map((o) => o[1]) });
const img = (w = 10, h = 10): [number, unknown] => [codes.paintImageXObject, ["img", w, h]];
const PAGE_H = 800;

describe("pdfImagePlacements", () => {
  it("10c.1e places an image under a transform with its pixel size, in points from the top left", () => {
    const out = pdfImagePlacements(list([[codes.transform, [100, 0, 0, 50, 10, 20]], img(300, 150)]), codes, PAGE_H);
    expect(out).toEqual([{ left: 10, top: 730, width: 100, height: 50, pixelWidth: 300, pixelHeight: 150 }]);
  });

  it("10c.1e places an image with no transform as the unit square at the bottom left", () => {
    const out = pdfImagePlacements(list([img(4, 5)]), codes, PAGE_H);
    expect(out).toEqual([{ left: 0, top: 799, width: 1, height: 1, pixelWidth: 4, pixelHeight: 5 }]);
  });

  it("10c.1e reads pixelWidth from args[1] and pixelHeight from args[2] of an image XObject", () => {
    const out = pdfImagePlacements(list([[codes.transform, [10, 0, 0, 10, 0, 0]], [codes.paintImageXObject, ["name", 640, 480]]]), codes, PAGE_H);
    expect(out[0]!.pixelWidth).toBe(640);
    expect(out[0]!.pixelHeight).toBe(480);
  });

  it("10c.1e reads the pixel size of an inline image from args[0].width and args[0].height", () => {
    const out = pdfImagePlacements(
      list([[codes.transform, [10, 0, 0, 10, 0, 0]], [codes.paintInlineImageXObject, [{ width: 40, height: 30 }]]]),
      codes,
      PAGE_H,
    );
    expect(out).toEqual([{ left: 0, top: 790, width: 10, height: 10, pixelWidth: 40, pixelHeight: 30 }]);
  });

  it("10c.1e multiplies transforms as new = current x args, the later transform applied first", () => {
    // scale by 2, then translate by (10, 20): the unit square corner (0,0) goes to (10,20) then (20,40); (1,1) to (22,42)
    const out = pdfImagePlacements(list([[codes.transform, [2, 0, 0, 2, 0, 0]], [codes.transform, [1, 0, 0, 1, 10, 20]], img()]), codes, 100);
    expect(out).toEqual([{ left: 20, top: 58, width: 2, height: 2, pixelWidth: 10, pixelHeight: 10 }]);
  });

  it("10c.1e restores the matrix saved before the transform", () => {
    const out = pdfImagePlacements(
      list([[codes.save, []], [codes.transform, [50, 0, 0, 50, 100, 100]], img(), [codes.restore, []], img()]),
      codes,
      PAGE_H,
    );
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ left: 100, top: 650, width: 50, height: 50 });
    expect(out[1]).toMatchObject({ left: 0, top: 799, width: 1, height: 1 });
  });

  it("10c.1e keeps a transform made before a save after the matching restore", () => {
    const out = pdfImagePlacements(
      list([[codes.transform, [10, 0, 0, 10, 0, 0]], [codes.save, []], [codes.transform, [2, 0, 0, 2, 0, 0]], [codes.restore, []], img()]),
      codes,
      PAGE_H,
    );
    expect(out[0]).toMatchObject({ width: 10, height: 10 });
  });

  it("10c.1e ignores a restore without a save", () => {
    const out = pdfImagePlacements(list([[codes.transform, [20, 0, 0, 20, 0, 0]], [codes.restore, []], img()]), codes, PAGE_H);
    expect(out[0]).toMatchObject({ width: 20, height: 20 });
  });

  it("10c.1e applies a form XObject matrix between begin and end and pops it at the end", () => {
    const out = pdfImagePlacements(
      list([[codes.paintFormXObjectBegin, [[3, 0, 0, 3, 10, 10], null]], img(), [codes.paintFormXObjectEnd, []], img()]),
      codes,
      PAGE_H,
    );
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ left: 10, top: 787, width: 3, height: 3 });
    expect(out[1]).toMatchObject({ left: 0, top: 799, width: 1, height: 1 });
  });

  it("10c.1e composes a form XObject matrix with the current matrix", () => {
    const out = pdfImagePlacements(
      list([[codes.transform, [10, 0, 0, 10, 0, 0]], [codes.paintFormXObjectBegin, [[1, 0, 0, 1, 5, 5], null]], img()]),
      codes,
      PAGE_H,
    );
    // the form translate applies first: (0,0) -> (5,5) -> (50,50); (1,1) -> (6,6) -> (60,60)
    expect(out[0]).toMatchObject({ left: 50, top: 740, width: 10, height: 10 });
  });

  it("10c.1e still pushes and pops a form XObject whose first arg is not a 6-number array", () => {
    const out = pdfImagePlacements(
      list([
        [codes.paintFormXObjectBegin, [null, null]],
        [codes.transform, [5, 0, 0, 5, 0, 0]],
        img(),
        [codes.paintFormXObjectEnd, []],
        img(),
      ]),
      codes,
      PAGE_H,
    );
    expect(out[0]).toMatchObject({ width: 5, height: 5 });
    expect(out[1]).toMatchObject({ width: 1, height: 1 });
  });

  it("10c.1e takes the axis-aligned bounds of a rotated image", () => {
    // (x, y) -> (-50y + 100, 20x + 10): x 0..1, y 0..1 gives x in [50, 100], y in [10, 30]
    const out = pdfImagePlacements(list([[codes.transform, [0, 20, -50, 0, 100, 10]], img()]), codes, 200);
    expect(out[0]).toMatchObject({ left: 50, top: 170, width: 50, height: 20 });
  });

  it("10c.1e takes the bounds of a flipped image with a negative vertical scale", () => {
    const out = pdfImagePlacements(list([[codes.transform, [100, 0, 0, -50, 0, 50]], img()]), codes, 200);
    expect(out[0]).toMatchObject({ left: 0, top: 150, width: 100, height: 50 });
  });

  it("10c.1e rounds left, top, width and height to 2 decimals", () => {
    const out = pdfImagePlacements(list([[codes.transform, [100.456, 0, 0, 50.123, 0.001, 0]], img()]), codes, PAGE_H);
    expect(out[0]).toMatchObject({ left: 0, top: 749.88, width: 100.46, height: 50.12 });
  });

  it("10c.1e returns the images in paint order and ignores other operators", () => {
    const out = pdfImagePlacements(
      list([
        [OTHER, ["x"]],
        [codes.transform, [10, 0, 0, 10, 0, 0]],
        img(1, 1),
        [OTHER, null],
        img(2, 2),
        [codes.paintInlineImageXObject, [{ width: 3, height: 3 }]],
      ]),
      codes,
      PAGE_H,
    );
    expect(out.map((p) => p.pixelWidth)).toEqual([1, 2, 3]);
  });

  it("10c.1e returns an empty list for an empty operator list", () => {
    expect(pdfImagePlacements({ fnArray: [], argsArray: [] }, codes, PAGE_H)).toEqual([]);
  });

  it("10c.1e skips images with missing or non-positive pixel sizes", () => {
    const out = pdfImagePlacements(
      list([
        [codes.transform, [10, 0, 0, 10, 0, 0]],
        [codes.paintImageXObject, ["a", 0, 10]],
        [codes.paintImageXObject, ["b", 10, -1]],
        [codes.paintImageXObject, ["c", "10", 10]],
        [codes.paintImageXObject, ["d"]],
        [codes.paintInlineImageXObject, [{ width: 0, height: 5 }]],
        [codes.paintInlineImageXObject, [{}]],
        [codes.paintInlineImageXObject, [{ width: 7, height: 8 }]],
      ]),
      codes,
      PAGE_H,
    );
    expect(out.map((p) => [p.pixelWidth, p.pixelHeight])).toEqual([[7, 8]]);
  });

  it("10c.1e never throws on malformed args", () => {
    const bad = list([
      [codes.transform, null],
      [codes.transform, "x"],
      [codes.transform, [1, 2, 3]],
      [codes.paintFormXObjectBegin, undefined],
      [codes.paintImageXObject, null],
      [codes.paintImageXObject, undefined],
      [codes.paintInlineImageXObject, null],
      [codes.paintInlineImageXObject, []],
      [codes.paintFormXObjectEnd, null],
      [codes.restore, null],
      [codes.save, null],
    ]);
    expect(() => pdfImagePlacements(bad, codes, PAGE_H)).not.toThrow();
    expect(pdfImagePlacements(bad, codes, PAGE_H)).toEqual([]);
  });

  it("10c.1e does not throw when argsArray is shorter than fnArray", () => {
    expect(() => pdfImagePlacements({ fnArray: [codes.transform, codes.paintImageXObject], argsArray: [[1, 0, 0, 1, 0, 0]] }, codes, PAGE_H)).not.toThrow();
  });
});

describe("print check core PDF walker", () => {
  it("A10 reads an image placement from a save, transform, paint, restore sequence", () => {
    const out = pdfImagePlacements(
      list([[codes.save, []], [codes.transform, [200, 0, 0, 100, 50, 60]], [codes.paintImageXObject, ["im0", 1000, 500]], [codes.restore, []]]),
      codes,
      PAGE_H,
    );
    expect(out).toEqual([{ left: 50, top: 640, width: 200, height: 100, pixelWidth: 1000, pixelHeight: 500 }]);
  });
});
