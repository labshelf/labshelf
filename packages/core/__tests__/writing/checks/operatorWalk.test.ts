/** Verifies that the operator walk finds a page's fonts and the drawn size of its images through nested transforms. */
import { walkOperators } from "../../../src/writing/checks/operatorWalk";

const OPS = { save: 10, restore: 11, transform: 12, setFont: 37, paintImageXObject: 85, paintFormXObjectBegin: 74, paintFormXObjectEnd: 75, showText: 44 };

function list(ops: Array<[keyof typeof OPS, unknown]>) {
  return { fnArray: ops.map(([name]) => OPS[name]), argsArray: ops.map(([, args]) => args) };
}

describe("walkOperators", () => {
  it("collects each font once, in first-use order", () => {
    const result = walkOperators(list([["setFont", ["f2", 10]], ["showText", null], ["setFont", ["f1", 9]], ["setFont", ["f2", 10]]]), OPS);
    expect(result.fontIds).toEqual(["f2", "f1"]);
  });

  it("sizes an image by the transform it is drawn under, as pdfTeX writes it", () => {
    const result = walkOperators(list([
      ["transform", [1, 0, 0, 1, 148.7, 488.4]],
      ["save", null],
      ["transform", [2.88, 0, 0, 2.88, 0, 0]],
      ["save", null],
      ["transform", [50, 0, 0, 50, 0, 0]],
      ["paintImageXObject", ["img", 50, 50]],
      ["restore", null],
      ["restore", null],
    ]), OPS);
    expect(result.images).toHaveLength(1);
    expect(result.images[0]).toMatchObject({ pixelWidth: 50, pixelHeight: 50 });
    expect(result.images[0]!.width).toBeCloseTo(144);
    expect(result.images[0]!.height).toBeCloseTo(144);
  });

  it("undoes a transform on restore and applies a form's matrix only inside the form", () => {
    const result = walkOperators(list([
      ["save", null],
      ["transform", [10, 0, 0, 10, 0, 0]],
      ["restore", null],
      ["paintFormXObjectBegin", [[0, 2, -3, 0, 5, 5], [0, 0, 1, 1]]],
      ["paintImageXObject", ["a", 100, 300]],
      ["paintFormXObjectEnd", null],
      ["paintImageXObject", ["b", 10, 10]],
    ]), OPS);
    expect(result.images.map(({ width, height }) => [width, height])).toEqual([[2, 3], [1, 1]]);
  });

  it("survives an unbalanced restore", () => {
    const result = walkOperators(list([["restore", null], ["paintImageXObject", ["a", 1, 1]]]), OPS);
    expect(result.images).toEqual([{ pixelWidth: 1, pixelHeight: 1, width: 1, height: 1 }]);
  });
});
