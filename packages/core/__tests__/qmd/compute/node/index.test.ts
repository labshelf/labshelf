/** Verifies that the Mathematica driver answers a Graphics or Graphics3D last value, and a Manipulate frame that renders to one, with a PNG data URL plus a labshelf-plot spec (2D lines and points, 3D meshes, labels), and the PNG alone when the graphic holds anything else (3.3); and that a request with preview true whose graphic or Manipulate frame yields a spec answers the spec alone with no PNG text, everything else answering as without preview (6.1); skipped when locateTool finds no wolframscript. */
import { parsePlotSpec } from "../../../../src/qmd/item/plotSpec";
import { cleanupTempDirs } from "../../../support/tempDirs";

import {
  behaviour, disposeRunner, DISK, graphic, MANIPULATE, parsedSpec, PLOT_3D, PNG_URL, previewBehaviour, run, runPreview, SIN_PLOT, sig4, specOf,
} from "./wolframCellHarness";

jest.setTimeout(180_000);

afterEach(cleanupTempDirs);
afterAll(disposeRunner);

describe("3.3 The Mathematica driver answers a graphic with the PNG plus a labshelf-plot spec, and PNG only when the graphic holds anything else.", () => {
  it("3.3a Plot answers a PNG data URL and a 2D spec of line traces with equal-length x and y, and no latex", behaviour(async (active) => {
    const result = await graphic(active, "wl-g-plot", "Plot[Sin[x], {x, 0, 6}]");
    expect(result.text).toMatch(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/);
    expect(result.latex).toBeUndefined();
    const spec = specOf(result);
    expect(spec.v).toBe(1);
    expect(spec.dim).toBe(2);
    expect(spec.traces.length).toBeGreaterThanOrEqual(1);
    for (const trace of spec.traces) {
      expect(trace.type).toBe("line");
      expect(trace.x?.length).toBeGreaterThan(1);
      expect(trace.y?.length).toBe(trace.x?.length);
    }
  }));

  it("3.3a every number in a Plot spec has at most 4 significant digits and the curve follows Sin", behaviour(async (active) => {
    const spec = specOf(await graphic(active, "wl-g-digits", "Plot[Sin[x], {x, 0, 6}]"));
    const trace = spec.traces[0];
    const xs = trace.x ?? [];
    const ys = trace.y ?? [];
    expect(xs.length).toBeGreaterThan(10);
    expect([...xs, ...ys].every(sig4)).toBe(true);
    const peak = Math.max(...(ys.filter((v) => v !== null) as number[]));
    expect(peak).toBeGreaterThan(0.99);
    expect(peak).toBeLessThanOrEqual(1);
  }));

  it("3.3a a Plot with a legend (a Legended value) answers the PNG and the spec of the plot inside", behaviour(async (active) => {
    const result = await graphic(active, "wl-g-legended", "Legended[Plot[Sin[x], {x, 0, 6}], \"sin\"]");
    expect(result.latex).toBeUndefined();
    const spec = specOf(result);
    expect(spec.dim).toBe(2);
    expect(spec.traces.length).toBeGreaterThanOrEqual(1);
  }));

  it("3.3b ListPlot of points gives a points trace", behaviour(async (active) => {
    const spec = specOf(await graphic(active, "wl-g-listplot", "ListPlot[{{1, 2}, {2, 3}, {3, 5}}]"));
    expect(spec.dim).toBe(2);
    expect(spec.traces).toHaveLength(1);
    expect(spec.traces[0].type).toBe("points");
    expect(spec.traces[0].x).toEqual([1, 2, 3]);
    expect(spec.traces[0].y).toEqual([2, 3, 5]);
  }));

  it("3.3b ParametricPlot of a circle gives a line trace that stays on the unit circle", behaviour(async (active) => {
    const spec = specOf(await graphic(active, "wl-g-param", "ParametricPlot[{Cos[t], Sin[t]}, {t, 0, 2 Pi}]"));
    expect(spec.dim).toBe(2);
    expect(spec.traces.length).toBeGreaterThanOrEqual(1);
    const trace = spec.traces[0];
    expect(trace.type).toBe("line");
    expect(trace.y?.length).toBe(trace.x?.length);
    (trace.x ?? []).forEach((x, i) => {
      const y = (trace.y ?? [])[i];
      expect(Math.hypot(x as number, y as number)).toBeCloseTo(1, 2);
    });
  }));

  it("3.3b PlotLabel and AxesLabel map to the title and the axis labels", behaviour(async (active) => {
    const spec = specOf(await graphic(active, "wl-g-labels", "Plot[x, {x, 0, 1}, PlotLabel -> \"T\", AxesLabel -> {\"a\", \"b\"}]"));
    expect(spec.title).toBe("T");
    expect(spec.axes.x.label).toBe("a");
    expect(spec.axes.y.label).toBe("b");
  }));

  it("3.3b a single AxesLabel in 2D is the y label", behaviour(async (active) => {
    const spec = specOf(await graphic(active, "wl-g-label-one", "Plot[x, {x, 0, 1}, AxesLabel -> \"only\"]"));
    expect(spec.axes.y.label).toBe("only");
    expect(spec.axes.x.label).toBeUndefined();
  }));

  it("3.3b Style and HoldForm labels are unwrapped and other expressions use their InputForm", behaviour(async (active) => {
    const spec = specOf(await graphic(active, "wl-g-label-wrap", "Plot[x, {x, 0, 1}, PlotLabel -> Style[\"S\", Bold], AxesLabel -> {HoldForm[\"h\"], uu + vv}]"));
    expect(spec.title).toBe("S");
    expect(spec.axes.x.label).toBe("h");
    expect(spec.axes.y.label).toBe("uu + vv");
  }));

  it("3.3b None, Automatic and an empty list give no label", behaviour(async (active) => {
    const none = specOf(await graphic(active, "wl-g-label-none", "Plot[x, {x, 0, 1}, PlotLabel -> None, AxesLabel -> {None, Automatic}]"));
    expect(none.title).toBeUndefined();
    expect(none.axes.x.label).toBeUndefined();
    expect(none.axes.y.label).toBeUndefined();
    const empty = specOf(await graphic(active, "wl-g-label-none", "Plot[x, {x, 0, 1}, AxesLabel -> {}]"));
    expect(empty.axes.x.label).toBeUndefined();
  }));

  it("3.3b a Graphics of directives and containers keeps its Line and Point primitives as one line and one points trace", behaviour(async (active) => {
    const spec = specOf(await graphic(active, "wl-g-containers", "Graphics[{Red, Thick, Tooltip[Line[{{0, 0}, {1, 1}}], \"t\"], PointSize[0.02], Point[{0, 0}]}]"));
    expect(spec.traces.map((t) => t.type).sort()).toEqual(["line", "points"]);
    const line = spec.traces.find((t) => t.type === "line");
    expect(line?.x).toEqual([0, 1]);
    expect(line?.y).toEqual([0, 1]);
    const points = spec.traces.find((t) => t.type === "points");
    expect(points?.x).toEqual([0]);
    expect(points?.y).toEqual([0]);
  }));

  it("3.3b a Line of several segments is one line trace with the segments joined by a null point", behaviour(async (active) => {
    const spec = specOf(await graphic(active, "wl-g-segments", "Graphics[Line[{{{0, 0}, {1, 1}}, {{2, 2}, {3, 3}}}]]"));
    expect(spec.traces).toHaveLength(1);
    expect(spec.traces[0].type).toBe("line");
    expect(spec.traces[0].x).toEqual([0, 1, null, 2, 3]);
    expect(spec.traces[0].y).toEqual([0, 1, null, 2, 3]);
  }));

  it("3.3b coordinates are rounded to 4 significant digits and a zero stays 0", behaviour(async (active) => {
    const spec = specOf(await graphic(active, "wl-g-round", "Graphics[Line[{{0, 0}, {1.23456789, 2}, {0.000123456, 100.0001}}]]"));
    expect(spec.traces[0].x).toEqual([0, 1.235, 0.0001235]);
    expect(spec.traces[0].y).toEqual([0, 2, 100]);
  }));

  it("3.3b a coordinate that is not a finite real is null in a line trace and dropped from a points trace", behaviour(async (active) => {
    const line = specOf(await graphic(active, "wl-g-nonfinite", "Graphics[Line[{{0, 0}, {1, ComplexInfinity}, {2, 3}}]]"));
    expect(line.traces[0].type).toBe("line");
    expect(line.traces[0].x?.length).toBe(3);
    expect(line.traces[0].y?.[0]).toBe(0);
    expect(line.traces[0].y?.[1]).toBeNull();
    expect(line.traces[0].y?.[2]).toBe(3);
    const points = specOf(await graphic(active, "wl-g-nonfinite", "Graphics[Point[{{0, 0}, {1, Indeterminate}, {2, 3}}]]"));
    expect(points.traces[0].type).toBe("points");
    expect(points.traces[0].x).toEqual([0, 2]);
    expect(points.traces[0].y).toEqual([0, 3]);
  }));

  it("3.3c Plot3D gives a 3D spec with a mesh trace of 0-based index triples within the vertex count, and parsePlotSpec accepts it", behaviour(async (active) => {
    const result = await graphic(active, "wl-g-plot3d", "Plot3D[Sin[x y], {x, 0, 3}, {y, 0, 3}]");
    expect(result.latex).toBeUndefined();
    const spec = specOf(result);
    expect(spec.dim).toBe(3);
    const mesh = spec.traces.find((t) => t.type === "mesh");
    expect(mesh).toBeDefined();
    const vertices = mesh?.vertices ?? [];
    const faces = mesh?.faces ?? [];
    expect(vertices.length).toBeGreaterThan(3);
    expect(vertices.every((v) => v.length === 3)).toBe(true);
    expect(faces.length).toBeGreaterThan(0);
    expect(faces.length).toBeLessThanOrEqual(20000);
    for (const face of faces) {
      expect(face).toHaveLength(3);
      for (const index of face) {
        expect(Number.isInteger(index)).toBe(true);
        expect(index).toBeGreaterThanOrEqual(0);
        expect(index).toBeLessThan(vertices.length);
      }
    }
    expect(Math.min(...faces.flat())).toBe(0);
    expect(parsePlotSpec(result.plot as string)).not.toBeNull();
  }));

  it("3.3c Plot3D labels map to title and the x, y and z axis labels", behaviour(async (active) => {
    const spec = specOf(await graphic(active, "wl-g-plot3d-labels", "Plot3D[x y, {x, 0, 1}, {y, 0, 1}, PlotLabel -> \"S\", AxesLabel -> {\"a\", \"b\", \"c\"}]"));
    expect(spec.dim).toBe(3);
    expect(spec.title).toBe("S");
    expect(spec.axes.x.label).toBe("a");
    expect(spec.axes.y.label).toBe("b");
    expect(spec.axes.z.label).toBe("c");
  }));

  it("3.3c a single AxesLabel in 3D is the z label", behaviour(async (active) => {
    const spec = specOf(await graphic(active, "wl-g-plot3d-one", "Plot3D[x y, {x, 0, 1}, {y, 0, 1}, AxesLabel -> \"height\"]"));
    expect(spec.axes.z.label).toBe("height");
    expect(spec.axes.x.label).toBeUndefined();
  }));

  it("3.3c a polygon with 4 indices is split as a fan and 1-based indices become 0-based", behaviour(async (active) => {
    const code = "Graphics3D[GraphicsComplex[{{0, 0, 0}, {1, 0, 0}, {1, 1, 0}, {0, 1, 0}}, Polygon[{{1, 2, 3, 4}}]]]";
    const spec = specOf(await graphic(active, "wl-g-fan", code));
    expect(spec.dim).toBe(3);
    expect(spec.traces).toHaveLength(1);
    expect(spec.traces[0].type).toBe("mesh");
    expect(spec.traces[0].vertices).toEqual([[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]]);
    expect(spec.traces[0].faces).toEqual([[0, 1, 2], [0, 2, 3]]);
  }));

  it("3.3c Polygon[{i,j,k}] and Polygon[{{i,j,k}}] are both read and Line primitives beside polygons are dropped", behaviour(async (active) => {
    const code = "Graphics3D[GraphicsComplex[{{0, 0, 0}, {1, 0, 0}, {1, 1, 0}, {0, 1, 0}}, {Polygon[{1, 2, 3}], Polygon[{{1, 3, 4}}], Line[{1, 2}]}]]";
    const spec = specOf(await graphic(active, "wl-g-forms", code));
    expect(spec.traces).toHaveLength(1);
    expect(spec.traces[0].type).toBe("mesh");
    expect(spec.traces[0].faces).toEqual([[0, 1, 2], [0, 2, 3]]);
  }));

  it("3.3c a Graphics3D without polygons gives line and points traces with z", behaviour(async (active) => {
    const line = specOf(await graphic(active, "wl-g-3d-line", "Graphics3D[Line[{{0, 0, 0}, {1, 2, 3}}]]"));
    expect(line.dim).toBe(3);
    expect(line.traces).toHaveLength(1);
    expect(line.traces[0]).toMatchObject({ type: "line", x: [0, 1], y: [0, 2], z: [0, 3] });
    const points = specOf(await graphic(active, "wl-g-3d-point", "Graphics3D[Point[{{0, 0, 0}, {1, 2, 3}}]]"));
    expect(points.traces).toHaveLength(1);
    expect(points.traces[0]).toMatchObject({ type: "points", x: [0, 1], y: [0, 2], z: [0, 3] });
  }));

  it("3.3c more than 20000 faces gives the PNG and no plot, while the default Plot3D beside it keeps one", behaviour(async (active) => {
    const small = await graphic(active, "wl-g-cap", "Plot3D[Sin[x y], {x, 0, 3}, {y, 0, 3}]");
    expect(small.plot).toBeDefined();
    const big = await graphic(active, "wl-g-cap", "Plot3D[Sin[x y], {x, 0, 3}, {y, 0, 3}, PlotPoints -> 150, MaxRecursion -> 0]");
    expect(big.plot).toBeUndefined();
    expect(big.latex).toBeUndefined();
  }));

  it("3.3d Disk and Text answer a PNG with no plot, and a Plot beside them answers a plot", behaviour(async (active) => {
    const disk = await graphic(active, "wl-g-nospec", "Graphics[{Disk[]}]");
    expect(disk.plot).toBeUndefined();
    expect(disk.latex).toBeUndefined();
    const text = await graphic(active, "wl-g-nospec", "Graphics[{Text[\"a\", {0, 0}]}]");
    expect(text.plot).toBeUndefined();
    expect(text.latex).toBeUndefined();
    const plot = await graphic(active, "wl-g-nospec", "Plot[x, {x, 0, 1}]");
    expect(typeof plot.plot).toBe("string");
  }));

  it("3.3d one unsupported primitive among lines means no plot, and the next cell still runs", behaviour(async (active) => {
    const mixed = await graphic(active, "wl-g-mixed", "Graphics[{Line[{{0, 0}, {1, 1}}], Circle[]}]");
    expect(mixed.plot).toBeUndefined();
    expect(mixed.latex).toBeUndefined();
    const sphere = await graphic(active, "wl-g-mixed", "Graphics3D[Sphere[]]");
    expect(sphere.plot).toBeUndefined();
    expect(sphere.latex).toBeUndefined();
    const empty = await graphic(active, "wl-g-mixed", "Graphics[{}]");
    expect(empty.plot).toBeUndefined();
    const plot = await graphic(active, "wl-g-mixed", "Plot[x, {x, 0, 1}]");
    expect(specOf(plot).traces.length).toBeGreaterThanOrEqual(1);
    const next = await run(active, "wl-g-mixed", "1 + 1");
    expect(next.status).toBe("ok");
    expect(next.latex).toBe("2");
  }));

  it("3.3e a Manipulate of a Plot with params answers the PNG, the control and a plot spec at the requested value", behaviour(async (active) => {
    const code = "Manipulate[Plot[a x, {x, 0, 1}], {a, 1, 3}]";
    const result = await graphic(active, "wl-g-manip", code, { a: 2 });
    expect(result.controls).toEqual([{ name: "a", kind: "slider", min: 1, max: 3, value: 2 }]);
    const spec = specOf(result);
    expect(spec.dim).toBe(2);
    const trace = spec.traces[0];
    expect(trace.type).toBe("line");
    expect(trace.y?.[trace.y.length - 1]).toBeCloseTo(2, 2);
    const initial = specOf(await graphic(active, "wl-g-manip", code));
    const last = initial.traces[0].y ?? [];
    expect(last[last.length - 1]).toBeCloseTo(1, 2);
  }));

  it("3.3e a Manipulate whose frame is not a graphic answers its controls without plot, and a graphic frame beside it has one", behaviour(async (active) => {
    const plain = await run(active, "wl-g-manip-plain", "Manipulate[a^2, {a, 1, 3}]");
    expect(plain.status).toBe("ok");
    expect(plain.controls).toHaveLength(1);
    expect(plain.plot).toBeUndefined();
    const graphicFrame = await graphic(active, "wl-g-manip-plain", "Manipulate[Plot[a x, {x, 0, 1}], {a, 1, 3}]");
    expect(typeof graphicFrame.plot).toBe("string");
  }));

  it("3.3e a Manipulate whose graphic frame holds an unsupported primitive answers PNG and controls without plot", behaviour(async (active) => {
    const disk = await graphic(active, "wl-g-manip-disk", "Manipulate[Graphics[Disk[{0, 0}, a]], {a, 1, 3}]");
    expect(disk.controls).toHaveLength(1);
    expect(disk.plot).toBeUndefined();
    const line = await graphic(active, "wl-g-manip-disk", "Manipulate[Graphics[Line[{{0, 0}, {a, a}}]], {a, 1, 3}]");
    expect(line.controls).toHaveLength(1);
    expect(specOf(line).traces[0].type).toBe("line");
  }));
});

describe("6.1 The Mathematica driver honours preview: a spec-bearing graphic answers the spec alone, anything else answers as without preview.", () => {
  it("6.1a a Plot with preview true answers ok with a 2D plot spec and no text", previewBehaviour(async (active) => {
    const result = await runPreview(active, "wl-p-plot", SIN_PLOT, true);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe("ok");
    const spec = parsedSpec(result.plot);
    expect(spec.dim).toBe(2);
    expect(spec.traces.length).toBeGreaterThanOrEqual(1);
    expect(result.text).toBeUndefined();
    expect(result.latex).toBeUndefined();
  }));

  it("6.1a the same Plot without preview answers the PNG data URL and the spec", previewBehaviour(async (active) => {
    const result = await runPreview(active, "wl-p-plot-full", SIN_PLOT, undefined);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe("ok");
    expect(result.text).toMatch(PNG_URL);
    expect(parsedSpec(result.plot).dim).toBe(2);
    // The preview gate is real: the same cell with preview true leaves out the PNG.
    const previewed = await runPreview(active, "wl-p-plot-full", SIN_PLOT, true);
    expect(previewed.status).toBe("ok");
    expect(previewed.text).toBeUndefined();
    expect(parsedSpec(previewed.plot).dim).toBe(2);
  }));

  it("6.1a the preview spec of a Plot equals the spec of the same cell run without preview", previewBehaviour(async (active) => {
    const full = await runPreview(active, "wl-p-same", SIN_PLOT, false);
    expect(full.text).toMatch(PNG_URL);
    const previewed = await runPreview(active, "wl-p-same", SIN_PLOT, true);
    expect(previewed.text).toBeUndefined();
    expect(parsedSpec(previewed.plot)).toEqual(parsedSpec(full.plot));
  }));

  it("6.1b a Manipulate with params and preview true answers the control, a plot spec at the requested value and no text", previewBehaviour(async (active) => {
    const result = await runPreview(active, "wl-p-manip", MANIPULATE, true, { a: 2 });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe("ok");
    expect(result.controls).toEqual([{ name: "a", kind: "slider", min: 1, max: 3, value: 2 }]);
    const spec = parsedSpec(result.plot);
    expect(spec.dim).toBe(2);
    const trace = spec.traces[0] as { y?: Array<number | null> };
    const ys = (trace.y ?? []).filter((y): y is number => y !== null);
    expect(ys[ys.length - 1]).toBeCloseTo(2, 2);
    expect(result.text).toBeUndefined();
  }));

  it("6.1b the same Manipulate without preview answers the PNG, the control and the spec", previewBehaviour(async (active) => {
    const full = await runPreview(active, "wl-p-manip-full", MANIPULATE, undefined, { a: 2 });
    expect(full.status).toBe("ok");
    expect(full.text).toMatch(PNG_URL);
    expect(full.controls).toEqual([{ name: "a", kind: "slider", min: 1, max: 3, value: 2 }]);
    expect(parsedSpec(full.plot).dim).toBe(2);
    const previewed = await runPreview(active, "wl-p-manip-full", MANIPULATE, true, { a: 2 });
    expect(previewed.text).toBeUndefined();
    expect(previewed.controls).toEqual(full.controls);
  }));

  it("6.1b a Plot3D with preview true answers a dim 3 spec and no text", previewBehaviour(async (active) => {
    const result = await runPreview(active, "wl-p-plot3d", PLOT_3D, true);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe("ok");
    expect(parsedSpec(result.plot).dim).toBe(3);
    expect(result.text).toBeUndefined();
    const full = await runPreview(active, "wl-p-plot3d", PLOT_3D, undefined);
    expect(full.text).toMatch(PNG_URL);
    expect(parsedSpec(full.plot).dim).toBe(3);
  }));

  it("6.1c Graphics[{Disk[]}] with preview true answers the PNG data URL and no plot", previewBehaviour(async (active) => {
    const result = await runPreview(active, "wl-p-disk", DISK, true);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe("ok");
    expect(result.text).toMatch(PNG_URL);
    expect(result.plot).toBeUndefined();
    // Contrast with a graphic that has a spec, so a driver that ignores preview altogether fails here too.
    const line = await runPreview(active, "wl-p-disk", SIN_PLOT, true);
    expect(line.text).toBeUndefined();
    expect(parsedSpec(line.plot).dim).toBe(2);
  }));

  it("6.1c 1 + 1 with preview true answers latex 2 as without preview", previewBehaviour(async (active) => {
    const plain = await runPreview(active, "wl-p-sum", "1 + 1", undefined);
    expect(plain.status).toBe("ok");
    expect(plain.latex).toBe("2");
    const result = await runPreview(active, "wl-p-sum", "1 + 1", true);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe("ok");
    expect(result.latex).toBe("2");
    expect(result.plot).toBeUndefined();
    expect(result.text).toBeUndefined();
    // Preview is honoured by the same session: the next plot cell leaves out the PNG.
    const line = await runPreview(active, "wl-p-sum", SIN_PLOT, true);
    expect(line.text).toBeUndefined();
  }));

  it("6.1c a Manipulate whose frame is not a graphic with preview true answers as without preview", previewBehaviour(async (active) => {
    const code = "Manipulate[a^2, {a, 1, 3}]";
    const plain = await runPreview(active, "wl-p-nongraphic", code, undefined, { a: 2 });
    expect(plain.status).toBe("ok");
    expect(plain.controls).toHaveLength(1);
    expect(plain.plot).toBeUndefined();
    const result = await runPreview(active, "wl-p-nongraphic", code, true, { a: 2 });
    expect(result.status).toBe("ok");
    expect(result.controls).toEqual(plain.controls);
    expect(result.plot).toBeUndefined();
    expect(result.latex).toBe(plain.latex);
    expect(result.text).toBe(plain.text);
    const graphicFrame = await runPreview(active, "wl-p-nongraphic", MANIPULATE, true, { a: 2 });
    expect(graphicFrame.text).toBeUndefined();
  }));

  it("6.1c a Manipulate whose graphic frame has no spec with preview true answers the PNG and the controls without plot", previewBehaviour(async (active) => {
    const code = "Manipulate[Graphics[Disk[{0, 0}, a]], {a, 1, 3}]";
    const result = await runPreview(active, "wl-p-manip-disk", code, true, { a: 2 });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe("ok");
    expect(result.text).toMatch(PNG_URL);
    expect(result.controls).toHaveLength(1);
    expect(result.plot).toBeUndefined();
    const line = await runPreview(active, "wl-p-manip-disk", MANIPULATE, true, { a: 2 });
    expect(line.text).toBeUndefined();
  }));

  it("6.1c a failing cell with preview true answers an error as without preview", previewBehaviour(async (active) => {
    const code = "Manipulate[Plot[a x, {x, 0, 1}], {a, 1}]";
    const plain = await runPreview(active, "wl-p-error", code, undefined);
    expect(plain.status).toBe("error");
    expect(plain.error).toMatch(/\{\s*a,\s*1\s*\}/);
    const result = await runPreview(active, "wl-p-error", code, true);
    expect(result.status).toBe("error");
    expect(result.error).toBe(plain.error);
    expect(result.plot).toBeUndefined();
    expect(result.text).toBeUndefined();
    const line = await runPreview(active, "wl-p-error", SIN_PLOT, true);
    expect(line.text).toBeUndefined();
  }));

  it("6.1c the Plot cell with preview false answers the PNG data URL and the spec, as with no preview key", previewBehaviour(async (active) => {
    const result = await runPreview(active, "wl-p-false", SIN_PLOT, false);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe("ok");
    expect(result.text).toMatch(PNG_URL);
    expect(parsedSpec(result.plot).dim).toBe(2);
    const previewed = await runPreview(active, "wl-p-false", SIN_PLOT, true);
    expect(previewed.text).toBeUndefined();
  }));
});
