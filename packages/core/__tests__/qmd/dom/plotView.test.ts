/** @jest-environment jsdom */
/**
 * Tests the plot view: the Plotly style pre-creation, the spec-to-figure mapping, and the theme reader,
 * all without plotly.js (it is never imported).
 */
import type { PlotSpec } from "../../../src/qmd/item/plotSpec";
import { preparePlotlyStyles, plotResetView, readPlotTheme, sameTheme, toPlotlyFigure } from "../../../src/qmd/dom/plotView";
import { STYLE_IDS, DEFAULT_PALETTE, layoutOf, tracesOf, axisOf, THEME, spec2, spec3, newDoc, styleById, nonceOf } from "./plotViewHarness";

describe("preparePlotlyStyles", () => {
  it("2.1a appends exactly the two style ids Plotly looks up, empty and in order, to head of an empty document", () => {
    const doc = newDoc();
    preparePlotlyStyles(doc);
    const heads = Array.from(doc.head.querySelectorAll("style"));
    expect(heads.map((s) => s.id)).toEqual([...STYLE_IDS]);
    expect(heads.map((s) => s.textContent)).toEqual(["", ""]);
    expect(doc.querySelectorAll("style")).toHaveLength(2);
  });

  it("2.1a appends one empty style per id to head carrying the page script's nonce", () => {
    const doc = newDoc();
    const script = doc.createElement("script");
    script.setAttribute("nonce", "n0nce");
    doc.head.appendChild(script);
    preparePlotlyStyles(doc);
    for (const id of STYLE_IDS) {
      const found = styleById(doc, id);
      expect(found).toHaveLength(1);
      expect(found[0]!.parentElement).toBe(doc.head);
      expect(found[0]!.textContent).toBe("");
      expect(nonceOf(found[0]!)).toBe("n0nce");
    }
  });

  it("2.1a takes the nonce from the first script that carries one", () => {
    const doc = newDoc();
    const plain = doc.createElement("script");
    const first = doc.createElement("script");
    first.setAttribute("nonce", "first");
    const second = doc.createElement("script");
    second.setAttribute("nonce", "second");
    doc.head.append(plain, first, second);
    preparePlotlyStyles(doc);
    expect(nonceOf(styleById(doc, STYLE_IDS[0]!)[0]!)).toBe("first");
  });

  it("2.1a adds nothing on a second call", () => {
    const doc = newDoc();
    preparePlotlyStyles(doc);
    const before = doc.querySelectorAll("style").length;
    preparePlotlyStyles(doc);
    expect(doc.querySelectorAll("style")).toHaveLength(before);
    expect(before).toBe(STYLE_IDS.length);
  });

  it("2.1a leaves an existing element of that id untouched and still adds the missing one", () => {
    const doc = newDoc();
    const script = doc.createElement("script");
    script.setAttribute("nonce", "abc");
    doc.head.appendChild(script);
    const existing = doc.createElement("style");
    existing.id = "plotly.js-style-global";
    existing.textContent = ".keep{color:red}";
    doc.body.appendChild(existing);
    preparePlotlyStyles(doc);
    const found = styleById(doc, STYLE_IDS[0]!);
    expect(found).toEqual([existing]);
    expect(existing.textContent).toBe(".keep{color:red}");
    expect(existing.hasAttribute("nonce")).toBe(false);
    expect(existing.parentElement).toBe(doc.body);
    expect(styleById(doc, STYLE_IDS[1]!)).toHaveLength(1);
  });

  it("2.1a uses an empty nonce when the page has no nonce'd script", () => {
    const doc = newDoc();
    doc.head.appendChild(doc.createElement("script"));
    preparePlotlyStyles(doc);
    for (const id of STYLE_IDS) {
      const found = styleById(doc, id);
      expect(found).toHaveLength(1);
      expect(nonceOf(found[0]!)).toBe("");
    }
  });
});

describe("toPlotlyFigure traces", () => {
  it("2.1b maps a 2D line trace to a scatter with mode lines", () => {
    const fig = toPlotlyFigure(spec2([{ type: "line", x: [0, 1, 2], y: [3, 4, 5] }]), THEME);
    expect(fig.data).toHaveLength(1);
    expect(fig.data[0]).toMatchObject({ type: "scatter", mode: "lines", x: [0, 1, 2], y: [3, 4, 5] });
  });

  it("2.1b maps a 2D points trace to a scatter with mode markers", () => {
    const fig = toPlotlyFigure(spec2([{ type: "points", x: [0, 1], y: [2, 3] }]), THEME);
    expect(fig.data[0]).toMatchObject({ type: "scatter", mode: "markers", x: [0, 1], y: [2, 3] });
  });

  it("2.1b maps a 3D line trace to scatter3d with z", () => {
    const fig = toPlotlyFigure(spec3([{ type: "line", x: [0, 1], y: [2, 3], z: [4, 5] }]), THEME);
    expect(fig.data[0]).toMatchObject({ type: "scatter3d", mode: "lines", x: [0, 1], y: [2, 3], z: [4, 5] });
  });

  it("2.1b maps a 3D points trace to scatter3d with markers", () => {
    const fig = toPlotlyFigure(spec3([{ type: "points", x: [0, 1], y: [2, 3], z: [4, 5] }]), THEME);
    expect(fig.data[0]).toMatchObject({ type: "scatter3d", mode: "markers", z: [4, 5] });
  });

  it("2.1b passes null values through as gaps", () => {
    const fig = toPlotlyFigure(spec2([{ type: "line", x: [0, 1, 2], y: [1, null, 3] }]), THEME);
    expect(tracesOf(fig)[0]!.y).toEqual([1, null, 3]);
  });

  it("2.1b maps a surface to a surface with showscale false", () => {
    const z = [[1, 2], [3, null]];
    const fig = toPlotlyFigure(spec3([{ type: "surface", x: [0, 1], y: [0, 1], z }]), THEME);
    expect(fig.data[0]).toMatchObject({ type: "surface", x: [0, 1], y: [0, 1], z, showscale: false });
  });

  it("2.1b maps mesh vertices to x/y/z and faces to i/j/k of a mesh3d", () => {
    const fig = toPlotlyFigure(
      spec3([{ type: "mesh", vertices: [[0, 0, 0], [1, 0, 0], [0, 2, 0], [0, 0, 3]], faces: [[0, 1, 2], [0, 1, 3]] }]),
      THEME,
    );
    expect(fig.data[0]).toMatchObject({
      type: "mesh3d",
      x: [0, 1, 0, 0],
      y: [0, 0, 2, 0],
      z: [0, 0, 0, 3],
      i: [0, 0],
      j: [1, 1],
      k: [2, 3],
    });
  });
});

describe("toPlotlyFigure colours, layout and config", () => {
  it("2.1c takes a trace colour from trace.color on lines, points, surfaces and meshes", () => {
    const fig = toPlotlyFigure(
      spec3([
        { type: "line", color: "#111111", x: [0], y: [0], z: [0] },
        { type: "points", color: "#222222", x: [0], y: [0], z: [0] },
        { type: "surface", color: "#333333", x: [0, 1], y: [0, 1], z: [[0, 0], [0, 0]] },
        { type: "mesh", color: "#444444", vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], faces: [[0, 1, 2]] },
      ]),
      THEME,
    );
    const d = tracesOf(fig);
    expect(d[0]!.line?.color).toBe("#111111");
    expect(d[1]!.marker?.color).toBe("#222222");
    expect(d[2]!.colorscale).toEqual([[0, "#333333"], [1, "#333333"]]);
    expect(d[3]!.color).toBe("#444444");
  });

  it("2.1c takes colours from the palette in order and wraps around", () => {
    const traces: PlotSpec["traces"] = [0, 1, 2, 3].map(() => ({ type: "line" as const, x: [0, 1], y: [0, 1] }));
    const d = tracesOf(toPlotlyFigure(spec2(traces), THEME));
    expect(d.map((t) => t.line?.color)).toEqual(["#aa0000", "#00aa00", "#0000aa", "#aa0000"]);
  });

  it("2.1c counts a trace with an explicit colour in the palette position of later traces", () => {
    const d = tracesOf(toPlotlyFigure(
      spec2([
        { type: "line", color: "#abcdef", x: [0], y: [0] },
        { type: "points", x: [0], y: [0] },
      ]),
      THEME,
    ));
    expect(d[1]!.marker?.color).toBe("#00aa00");
  });

  it("2.1c copies trace names and shows the legend only when a trace has a name", () => {
    const named = toPlotlyFigure(spec2([{ type: "line", name: "alpha", x: [0], y: [0] }, { type: "line", x: [0], y: [0] }]), THEME);
    expect(tracesOf(named)[0]!.name).toBe("alpha");
    expect(layoutOf(named).showlegend).toBe(true);
    const unnamed = toPlotlyFigure(spec2([{ type: "line", x: [0], y: [0] }]), THEME);
    expect(layoutOf(unnamed).showlegend).toBe(false);
  });

  it("2.1c puts axis labels, log type and log10 ranges on xaxis and yaxis in 2D", () => {
    const fig = toPlotlyFigure(
      spec2([{ type: "line", x: [1, 2], y: [1, 2] }], {
        axes: { x: { label: "time", log: true, range: [10, 1000] }, y: { range: [-2, 5] } },
      }),
      THEME,
    );
    const layout = layoutOf(fig);
    const xaxis = axisOf(layout.xaxis);
    const yaxis = axisOf(layout.yaxis);
    // 2D axis titles are level annotations, never Plotly's rotated axis title.
    expect(xaxis.title).toBeUndefined();
    expect((layout as { annotations?: object[] }).annotations).toEqual([expect.objectContaining({ text: "time", xref: "paper", x: 1, xanchor: "right", showarrow: false })]);
    expect(xaxis.type).toBe("log");
    expect(xaxis.range?.[0]).toBeCloseTo(1, 10);
    expect(xaxis.range?.[1]).toBeCloseTo(3, 10);
    expect(yaxis.type).toBe("linear");
    expect(yaxis.range).toEqual([-2, 5]);
    expect(yaxis.title).toBeUndefined();
  });

  it("2.1c sets no range on an axis without one", () => {
    const layout = layoutOf(toPlotlyFigure(spec2([{ type: "line", x: [0], y: [0] }]), THEME));
    expect(axisOf(layout.xaxis).range).toBeUndefined();
    expect(axisOf(layout.xaxis).type).toBe("linear");
  });

  it("2.1c colours the grid, zero line and text of 2D axes from the theme", () => {
    const layout = layoutOf(toPlotlyFigure(spec2([{ type: "line", x: [0], y: [0] }]), THEME));
    for (const axis of [axisOf(layout.xaxis), axisOf(layout.yaxis)]) {
      expect(axis.gridcolor).toBe("#445566");
      expect(axis.zeroline).toBe(false);
      expect(axis.color).toBe(THEME.muted);
    }
  });

  it("2.1c puts the axes of a 3D plot on the scene and never on layout.xaxis", () => {
    const fig = toPlotlyFigure(
      spec3([{ type: "line", x: [1], y: [1], z: [1] }], {
        axes: { x: { label: "a" }, y: { label: "b", log: true, range: [1, 100] }, z: { label: "c", range: [0, 9] } },
      }),
      THEME,
    );
    const layout = layoutOf(fig);
    const scene = layout.scene;
    if (!scene) throw new Error("scene is missing");
    expect(layout.xaxis).toBeUndefined();
    expect(layout.yaxis).toBeUndefined();
    expect(scene.xaxis.title).toMatchObject({ text: "a", font: { color: THEME.muted } });
    expect(scene.yaxis.title).toMatchObject({ text: "b", font: { color: THEME.muted } });
    expect(scene.yaxis.type).toBe("log");
    expect(scene.yaxis.range?.[0]).toBeCloseTo(0, 10);
    expect(scene.yaxis.range?.[1]).toBeCloseTo(2, 10);
    expect(scene.zaxis.title).toMatchObject({ text: "c", font: { color: THEME.muted } });
    expect(scene.zaxis.type).toBe("linear");
    expect(scene.zaxis.range).toEqual([0, 9]);
    expect(scene.zaxis.gridcolor).toBe("#445566");
    expect(scene.zaxis.color).toBe(THEME.muted);
    expect(scene.zaxis.showbackground).toBe(false);
  });

  it("2.1c makes the backgrounds transparent and takes the font from the theme", () => {
    const layout = layoutOf(toPlotlyFigure(spec2([{ type: "line", x: [0], y: [0] }]), THEME));
    expect(layout.paper_bgcolor).toBe("rgba(0,0,0,0)");
    expect(layout.plot_bgcolor).toBe("rgba(0,0,0,0)");
    expect(layout.font).toEqual({ color: "#112233", family: "Test Sans" });
  });

  it("2.1c sets the title only when the spec has one", () => {
    const withTitle = layoutOf(toPlotlyFigure(spec2([{ type: "line", x: [0], y: [0] }], { title: "Decay" }), THEME));
    expect(withTitle.title?.text).toBe("Decay");
    const without = layoutOf(toPlotlyFigure(spec2([{ type: "line", x: [0], y: [0] }]), THEME));
    expect(without.title).toBeUndefined();
  });

  it("2.1c keeps the zoom across redraws with a fixed uirevision and closest hover", () => {
    const layout = layoutOf(toPlotlyFigure(spec2([{ type: "line", x: [0], y: [0] }]), THEME));
    expect(layout.uirevision).toBe("labshelf");
    expect(layout.hovermode).toBe("closest");
  });

  it("S2 hides the Plotly modebar, keeps displaylogo false and responsive true, and leaves the wheel and double-click to the output", () => {
    const fig = toPlotlyFigure(spec2([{ type: "line", x: [0], y: [0] }]), THEME);
    expect(fig.config).toEqual({ displaylogo: false, responsive: true, displayModeBar: false, scrollZoom: false, doubleClick: false });
  });

  it("S2 keeps small margins, 8 to 32 px, and lets 2D axes grow them for their tick labels and titles", () => {
    for (const spec of [spec2([{ type: "line", x: [0], y: [0] }]), spec2([{ type: "line", x: [0], y: [0] }], { title: "T" }), spec3([{ type: "line", x: [0], y: [0], z: [0] }])]) {
      const margin = layoutOf(toPlotlyFigure(spec, THEME)).margin!;
      for (const side of [margin.l, margin.r, margin.t, margin.b]) {
        expect(side).toBeGreaterThanOrEqual(0);
        expect(side).toBeLessThanOrEqual(32);
      }
    }
    const layout = layoutOf(toPlotlyFigure(spec2([{ type: "line", x: [0], y: [0] }]), THEME));
    expect(axisOf(layout.xaxis).automargin).toBe(true);
    expect(axisOf(layout.yaxis).automargin).toBe(true);
  });

  it("S2 turns Plotly's hover label off on every trace, the output drawing its own card", () => {
    const fig = toPlotlyFigure(spec2([{ type: "line", x: [0], y: [0] }, { type: "points", x: [0], y: [0], name: "b" }]), THEME);
    expect(layoutOf(fig).hoverlabel).toBeUndefined();
    for (const trace of fig.data) expect((trace as { hoverinfo?: string }).hoverinfo).toBe("none");
  });

  it("S2 draws only the hairline grid in the theme's soft border colour on 2D and 3D axes", () => {
    const two = layoutOf(toPlotlyFigure(spec2([{ type: "line", x: [0], y: [0] }]), THEME));
    const three = layoutOf(toPlotlyFigure(spec3([{ type: "line", x: [0], y: [0], z: [0] }]), THEME));
    for (const axis of [two.xaxis, two.yaxis, three.scene?.xaxis, three.scene?.yaxis, three.scene?.zaxis]) {
      expect(axisOf(axis).showline).toBe(false);
      expect(axisOf(axis).gridcolor).toBe(THEME.grid);
    }
  });

  it("S2 sets the title in the theme font at a modest size", () => {
    const layout = layoutOf(toPlotlyFigure(spec2([{ type: "line", x: [0], y: [0] }], { title: "Sine" }), THEME));
    expect(layout.title?.text).toBe("Sine");
    expect(layout.title?.font?.family).toBe(THEME.font);
    expect(layout.title?.font?.size).toBeGreaterThanOrEqual(12);
    expect(layout.title?.font?.size).toBeLessThanOrEqual(16);
  });

  it("S2 pans on drag in 2D and rotates as a turntable in 3D", () => {
    expect(layoutOf(toPlotlyFigure(spec2([{ type: "line", x: [0], y: [0] }]), THEME)).dragmode).toBe("pan");
    expect(layoutOf(toPlotlyFigure(spec3([{ type: "line", x: [0], y: [0], z: [0] }]), THEME)).scene?.dragmode).toBe("turntable");
  });
});

describe("plotResetView", () => {
  it("S3 autoranges both axes of a 2D plot without a set range", () => {
    expect(plotResetView(spec2([{ type: "line", x: [0], y: [0] }]))).toEqual({ "xaxis.autorange": true, "yaxis.autorange": true });
  });

  it("S3 restores the spec's own range on a 2D axis that sets one, in log units on a log axis", () => {
    const spec = spec2([{ type: "line", x: [1], y: [1] }], { axes: { x: { range: [0, 5] }, y: { range: [1, 100], log: true } } });
    expect(plotResetView(spec)).toEqual({ "xaxis.range": [0, 5], "yaxis.range": [0, 2] });
  });

  it("S3 resets the camera of a 3D plot to Plotly's default view", () => {
    expect(plotResetView(spec3([{ type: "line", x: [0], y: [0], z: [0] }]))).toEqual({
      "scene.camera": { eye: { x: 1.25, y: 1.25, z: 1.25 }, center: { x: 0, y: 0, z: 0 }, up: { x: 0, y: 0, z: 1 } },
    });
  });
});

describe("readPlotTheme", () => {
  let el: HTMLElement;

  beforeEach(() => {
    el = document.createElement("div");
    document.body.appendChild(el);
  });

  afterEach(() => {
    el.remove();
  });

  it("2.1d reads the text, grid, font and background tokens and the palette", () => {
    el.style.setProperty("--ls-fg", "#102030");
    el.style.setProperty("--ls-bg", "#fafafa");
    el.style.setProperty("--ls-border-soft", "#405060");
    el.style.setProperty("--ls-font", "Fira Sans");
    el.style.setProperty("--qmd-plot-palette", "#111111,#222222,#333333");
    expect(readPlotTheme(el)).toEqual({
      text: "#102030",
      muted: "#102030",
      grid: "#405060",
      font: "Fira Sans",
      bg: "#fafafa",
      palette: ["#111111", "#222222", "#333333"],
    });
  });

  it("2.1d trims the values and drops empty palette parts", () => {
    el.style.setProperty("--ls-fg", "  #102030  ");
    el.style.setProperty("--qmd-plot-palette", " #111111 , ,#222222,, ");
    const theme = readPlotTheme(el);
    expect(theme.text).toBe("#102030");
    expect(theme.palette).toEqual(["#111111", "#222222"]);
  });

  it("2.1d falls back to the defaults when the tokens are unset", () => {
    expect(readPlotTheme(el)).toEqual({
      text: "#808080",
      muted: "#808080",
      grid: "rgba(128, 128, 128, .2)",
      font: "sans-serif",
      bg: "#ffffff",
      palette: [...DEFAULT_PALETTE],
    });
  });

  it("2.1d falls back for a token that is set to blanks only", () => {
    el.style.setProperty("--ls-fg", "   ");
    el.style.setProperty("--qmd-plot-palette", " , ");
    const theme = readPlotTheme(el);
    expect(theme.text).toBe("#808080");
    expect(theme.palette).toEqual([...DEFAULT_PALETTE]);
  });

  it("2.1d falls back to the ten default colours when only the palette token is unset", () => {
    el.style.setProperty("--ls-fg", "#102030");
    expect(readPlotTheme(el).palette).toEqual([
      "#4e79a7", "#f28e2b", "#e15759", "#76b7b2", "#59a14f", "#edc948", "#b07aa1", "#ff9da7", "#9c755f", "#bab0ac",
    ]);
  });
});

describe("sameTheme", () => {
  it("S2 tells two themes apart by their background colour", () => {
    expect(sameTheme(THEME, { ...THEME, palette: [...THEME.palette] })).toBe(true);
    expect(sameTheme(THEME, { ...THEME, bg: "#000000" })).toBe(false);
  });
});
