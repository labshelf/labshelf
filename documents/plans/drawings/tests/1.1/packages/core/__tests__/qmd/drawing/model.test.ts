// Tests the labshelf-drawing model v1 (decision D2): parseDrawingModel validates and rounds, formatDrawingModel writes one line; the model half of acceptance A1.
import { formatDrawingModel, parseDrawingModel, type DrawingModel } from "../../../src/qmd/drawing/model";

type Json = Record<string, unknown>;

const point = (id: string, x: number, y: number, extra: Json = {}): Json => ({ id, x, y, dot: true, ...extra });
const model = (points: Json[], items: Json[] = []): Json => ({ v: 1, points, items });
const parse = (value: unknown): DrawingModel | null => parseDrawingModel(typeof value === "string" ? value : JSON.stringify(value));
const must = (value: unknown): DrawingModel => {
  const out = parse(value);
  if (out === null) { throw new Error(`expected a valid model: ${JSON.stringify(value)}`); }
  return out;
};
const asModel = (value: Json): DrawingModel => value as unknown as DrawingModel;

const axes = (id: string, extra: Json = {}): Json => ({ k: "axes", id, o: "O", x: [-5, 5], y: [-3, 3], sx: 1, sy: 1, ticks: true, ...extra });
const ab = [point("A", 0, 0), point("B", 4, 0)];
const origin = [point("O", 0, 0, { dot: false })];

describe("A1 a valid model reads back", () => {
  it("A1 reads an empty model", () => {
    expect(must(model([]))).toEqual({ v: 1, points: [], items: [] });
  });

  it("A1 reads labelled points and segments with every arrow kind", () => {
    const input = model(
      [point("A", 0, 0, { label: "$A$" }), point("B", 4, 0, { label: "$B$" }), point("C", 2, 3, { dot: false })],
      [
        { k: "seg", a: "A", b: "B", arrow: "none" },
        { k: "seg", a: "B", b: "C", arrow: "end", label: "$f$", style: { color: "red", dash: "dashed" } },
        { k: "seg", a: "C", b: "A", arrow: "both", style: { dash: "dotted" } },
      ],
    );
    expect(must(input)).toEqual(input);
  });

  it("A1 reads a circle", () => {
    const input = model(ab, [{ k: "circle", c: "A", r: 2.5 }]);
    expect(must(input)).toEqual(input);
  });

  it("A1 reads a rectangle", () => {
    const input = model(ab, [{ k: "rect", a: "A", b: "B" }]);
    expect(must(input)).toEqual(input);
  });

  it("A1 reads an open and a closed polyline", () => {
    const pts = [...ab, point("C", 2, 3)];
    const input = model(pts, [{ k: "poly", pts: ["A", "B", "C"], closed: true }, { k: "poly", pts: ["A", "C"], closed: false }]);
    expect(must(input)).toEqual(input);
  });

  it("A1 reads a text item", () => {
    const input = model([], [{ k: "text", x: 1.5, y: -2, tex: "$\\alpha + \\beta$" }]);
    expect(must(input)).toEqual(input);
  });

  it("A1 reads axes with a function on them", () => {
    const input = model(origin, [axes("ax1", { xlabel: "$t$", ylabel: "$v$" }), { k: "fn", axes: "ax1", expr: "sin(x)/x", label: "$f$" }]);
    expect(must(input)).toEqual(input);
  });

  it("A1 keeps an expression that does not parse, because the model does not parse expr", () => {
    const input = model(origin, [axes("ax1"), { k: "fn", axes: "ax1", expr: "2 +* (" }]);
    expect(must(input)).toEqual(input);
  });

  it("A1 leaves automatic fields absent", () => {
    const out = must(model([point("A", 1, 2)], [{ k: "seg", a: "A", b: "A", arrow: "none" }]));
    expect(Object.keys(out.points[0]!).sort()).toEqual(["dot", "id", "x", "y"]);
    expect(Object.keys(out.items[0]!).sort()).toEqual(["a", "arrow", "b", "k"]);
  });
});

describe("A1 a model that is not valid is rejected", () => {
  it.each([
    ["an empty string", ""],
    ["text that is not JSON", "not json"],
    ["a truncated object", '{"v":1,"points":['],
    ["an array", "[]"],
    ["null", "null"],
    ["an object without v", '{"points":[],"items":[]}'],
    ["an unknown version", '{"v":2,"points":[],"items":[]}'],
    ["a version given as a string", '{"v":"1","points":[],"items":[]}'],
  ])("A1 rejects %s", (_name, json) => {
    expect(parseDrawingModel(json)).toBeNull();
  });

  it.each([
    ["a segment start", [{ k: "seg", a: "Z", b: "B", arrow: "none" }]],
    ["a segment end", [{ k: "seg", a: "A", b: "Z", arrow: "end" }]],
    ["a circle centre", [{ k: "circle", c: "Z", r: 1 }]],
    ["a rectangle corner", [{ k: "rect", a: "A", b: "Z" }]],
    ["a polyline vertex", [{ k: "poly", pts: ["A", "B", "Z"], closed: false }]],
    ["an axes origin", [axes("ax1", { o: "Z" })]],
  ])("A1 rejects a dangling point id in %s", (_name, items) => {
    expect(parse(model(ab, items))).toBeNull();
  });

  it("A1 rejects a function whose axes id does not exist", () => {
    expect(parse(model([], [{ k: "fn", axes: "nope", expr: "x" }]))).toBeNull();
  });

  it("A1 rejects a function whose axes id names a point", () => {
    expect(parse(model(ab, [{ k: "fn", axes: "A", expr: "x" }]))).toBeNull();
  });

  it("A1 rejects duplicate point ids", () => {
    expect(parse(model([point("A", 0, 0), point("A", 1, 1)]))).toBeNull();
  });

  it("A1 rejects duplicate axes ids", () => {
    expect(parse(model(origin, [axes("ax1"), axes("ax1", { x: [0, 1] })]))).toBeNull();
  });

  // 1e999 is valid JSON and reads as Infinity.
  it.each([
    ["a point x", '{"v":1,"points":[{"id":"A","x":1e999,"y":0,"dot":true}],"items":[]}'],
    ["a point y", '{"v":1,"points":[{"id":"A","x":0,"y":-1e999,"dot":true}],"items":[]}'],
    ["a circle radius", '{"v":1,"points":[{"id":"A","x":0,"y":0,"dot":true}],"items":[{"k":"circle","c":"A","r":1e999}]}'],
    ["a text position", '{"v":1,"points":[],"items":[{"k":"text","x":1e999,"y":0,"tex":"a"}]}'],
  ])("A1 rejects a non-finite number in %s", (_name, json) => {
    expect(parseDrawingModel(json)).toBeNull();
  });

  it.each([
    ["an empty x range", { x: [3, 3] }],
    ["a reversed x range", { x: [5, 1] }],
    ["an empty y range", { y: [0, 0] }],
    ["a reversed y range", { y: [2, -2] }],
  ])("A1 rejects axes with %s", (_name, extra) => {
    expect(parse(model(origin, [axes("ax1", extra)]))).toBeNull();
  });
});

describe("A1 coordinates are rounded to 0.01", () => {
  it("A1 rounds point coordinates", () => {
    const out = must(model([point("A", 1.234, -0.456), point("B", 1.236, 10.001)]));
    expect(out.points.map((p) => [p.x, p.y])).toEqual([[1.23, -0.46], [1.24, 10]]);
  });

  it("A1 rounds a circle radius and a text position", () => {
    const out = must(model(ab, [{ k: "circle", c: "A", r: 2.718 }, { k: "text", x: 0.999, y: 3.14159, tex: "a" }]));
    expect(out.items[0]).toMatchObject({ r: 2.72 });
    expect(out.items[1]).toMatchObject({ x: 1, y: 3.14 });
  });

  it("A1 leaves values already at 0.01 alone", () => {
    const out = must(model([point("A", 0.07, 12.5)]));
    expect(out.points[0]).toMatchObject({ x: 0.07, y: 12.5 });
  });
});

describe("A1 formatDrawingModel", () => {
  const sample = asModel(model(
    [point("A", 0, 0, { label: "$A$" }), point("B", 4, 0)],
    [{ k: "seg", a: "A", b: "B", arrow: "end", label: "line\nbreak \"quoted\"" }],
  ));

  it("A1 writes one line of JSON", () => {
    const text = formatDrawingModel(sample);
    expect(text).not.toMatch(/[\r\n]/);
    expect(JSON.parse(text)).toEqual(sample);
  });

  it("A1 writes text that parses back to the same model", () => {
    expect(must(formatDrawingModel(sample))).toEqual(sample);
  });

  it("A1 writes the same text after a round trip", () => {
    const text = formatDrawingModel(sample);
    expect(formatDrawingModel(must(text))).toBe(text);
  });

  it("A1 writes no key for a field that is absent", () => {
    const text = formatDrawingModel(asModel(model([point("A", 1, 2)])));
    expect(text).not.toMatch(/"(label|at|side|style|bend)"|undefined|null/);
  });

  it("A1 writes a model with no points and no items", () => {
    expect(JSON.parse(formatDrawingModel(asModel(model([]))))).toEqual({ v: 1, points: [], items: [] });
  });
});
