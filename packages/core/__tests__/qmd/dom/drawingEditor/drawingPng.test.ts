/** @jest-environment jsdom */
import { createCanvas, loadImage, Path2D } from "@napi-rs/canvas";

import { layoutDrawing, type LabelBox } from "../../../../src/drawing/drawingLayout";
import { paintDrawingPng, type CanvasFactory } from "../../../../src/qmd/dom/drawingEditor/drawingPng";
import { formatDrawingSvg } from "../../../../src/drawing/drawingSvg";

const NS = 'xmlns="http://www.w3.org/2000/svg"';
const svgOf = (inner: string, w = 40, h = 20) => `<svg ${NS} width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${inner}</svg>`;

// The Node factory of the spec: @napi-rs/canvas. `created` records the sizes asked for.
function factory(created: Array<[number, number]> = []): CanvasFactory {
  return {
    create(width: number, height: number) {
      created.push([width, height]);
      const canvas = createCanvas(width, height);
      return {
        getContext: (kind: "2d") => canvas.getContext(kind) as unknown as CanvasRenderingContext2D | null,
        toDataURL: (type: "image/png") => canvas.toDataURL(type),
      };
    },
  };
}

type Pixels = { width: number; height: number; at(x: number, y: number): [number, number, number, number] };
async function decode(url: string | null): Promise<Pixels> {
  if (url === null) throw new Error("no data url");
  expect(url.startsWith("data:image/png;base64,")).toBe(true);
  const img = await loadImage(Buffer.from(url.slice("data:image/png;base64,".length), "base64"));
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, img.width, img.height).data;
  return {
    width: img.width,
    height: img.height,
    at: (x, y) => {
      const i = (y * img.width + x) * 4;
      return [data[i] ?? -1, data[i + 1] ?? -1, data[i + 2] ?? -1, data[i + 3] ?? -1];
    },
  };
}
const isDark = (p: [number, number, number, number]) => p[3] > 200 && p[0] < 100 && p[1] < 100 && p[2] < 100;
const isWhite = (p: [number, number, number, number]) => p[3] === 255 && p[0] > 240 && p[1] > 240 && p[2] > 240;
function inkBox(px: Pixels): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = px.width, y0 = px.height, x1 = -1, y1 = -1;
  for (let y = 0; y < px.height; y += 1) {
    for (let x = 0; x < px.width; x += 1) {
      if (!isDark(px.at(x, y))) continue;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
  }
  return { x0, y0, x1, y1 };
}
const paint = async (svg: string, scale?: number) => decode(paintDrawingPng(svg, factory(), scale));

beforeAll(() => {
  // The DOM host has Path2D; in Node the canvas package's class stands in for it.
  (globalThis as unknown as { Path2D: unknown }).Path2D = Path2D;
});

describe("A8 paintDrawingPng: canvas and background", () => {
  it("A8 asks for a canvas 3 times the svg size by default and returns a PNG data URL", async () => {
    const created: Array<[number, number]> = [];
    const url = paintDrawingPng(svgOf(""), factory(created));
    expect(created).toEqual([[120, 60]]);
    const px = await decode(url);
    expect([px.width, px.height]).toEqual([120, 60]);
  });

  it("A8 honours another scale", async () => {
    const created: Array<[number, number]> = [];
    paintDrawingPng(svgOf(""), factory(created), 2);
    expect(created).toEqual([[80, 40]]);
  });

  it("A8 paints black on a white background", async () => {
    const px = await paint(svgOf('<rect x="10" y="5" width="20" height="10" fill="currentColor"/>'));
    expect(isWhite(px.at(2, 2))).toBe(true);
    expect(isWhite(px.at(117, 57))).toBe(true);
    expect(isDark(px.at(60, 30))).toBe(true);
  });
});

describe("A8 paintDrawingPng: elements", () => {
  it("A8 paints currentColor as black and leaves fill none unless set", async () => {
    const px = await paint(svgOf('<rect x="10" y="5" width="20" height="10" stroke="currentColor" stroke-width="1" fill="none"/>'));
    expect(isDark(px.at(30, 30))).toBe(true); // left edge (x = 10 * 3)
    expect(isWhite(px.at(60, 30))).toBe(true); // interior stays white
  });

  it("A8 paints a fill colour", async () => {
    const px = await paint(svgOf('<rect x="10" y="5" width="20" height="10" fill="#ff0000"/>'));
    const [r, g, b] = px.at(60, 30);
    expect(r).toBeGreaterThan(200);
    expect(g).toBeLessThan(60);
    expect(b).toBeLessThan(60);
  });

  it("A8 paints a path from its d string", async () => {
    const px = await paint(svgOf('<path d="M10 5L30 5L30 15L10 15Z" fill="currentColor"/>'));
    expect(isDark(px.at(60, 30))).toBe(true);
    expect(isWhite(px.at(10, 10))).toBe(true);
  });

  it("paints the cubic pieces of curves, ellipses and arcs, and a fill's opacity", async () => {
    const px = await paint(svgOf('<path d="M10 10C10 2 30 2 30 10C30 18 10 18 10 10Z" fill="black" fill-opacity="0.5"/>'));
    const [r, , , a] = px.at(60, 30);
    expect(a).toBe(255);
    expect(r).toBeGreaterThan(80);
    expect(r).toBeLessThan(180);
    expect(isWhite(px.at(4, 4))).toBe(true);
  });

  it("A8 strokes a line", async () => {
    const px = await paint(svgOf('<line x1="0" y1="10" x2="40" y2="10" stroke="currentColor" stroke-width="2"/>'));
    expect(isDark(px.at(60, 30))).toBe(true);
    expect(isWhite(px.at(60, 10))).toBe(true);
    expect(isWhite(px.at(60, 50))).toBe(true);
  });

  it("A8 paints a circle", async () => {
    const px = await paint(svgOf('<circle cx="20" cy="10" r="6" fill="currentColor"/>'));
    expect(isDark(px.at(60, 30))).toBe(true);
    expect(isDark(px.at(60 + 15, 30))).toBe(true); // 5 units right of the centre
    expect(isWhite(px.at(60 + 24, 30))).toBe(true); // 8 units right, outside r = 6
  });

  it("A8 paints a polygon and a polyline", async () => {
    const poly = await paint(svgOf('<polygon points="5,2 35,2 20,18" fill="currentColor"/>'));
    expect(isDark(poly.at(60, 12))).toBe(true);
    expect(isWhite(poly.at(10, 50))).toBe(true);
    const line = await paint(svgOf('<polyline points="5,10 20,10 35,10" fill="none" stroke="currentColor" stroke-width="2"/>'));
    expect(isDark(line.at(60, 30))).toBe(true);
    expect(isWhite(line.at(60, 10))).toBe(true);
  });

  it("A8 paints a use that points to a local id, applying its transform", async () => {
    const svg = svgOf('<defs><path id="sq" d="M0 0L8 0L8 8L0 8Z" fill="currentColor"/></defs><use href="#sq" transform="translate(20 10)"/>');
    const px = await paint(svg);
    expect(isDark(px.at(24 * 3, 14 * 3))).toBe(true);
    expect(isWhite(px.at(4 * 3, 4 * 3))).toBe(true);
    expect(isWhite(px.at(32 * 3, 14 * 3))).toBe(true); // 12 units right of the origin: past the 8-wide square at 20..28
  });

  it("A8 applies the transform of a group", async () => {
    const px = await paint(svgOf('<g transform="translate(20 10)"><rect x="0" y="0" width="8" height="8" fill="currentColor"/></g>'));
    expect(isDark(px.at(24 * 3, 14 * 3))).toBe(true);
    expect(isWhite(px.at(4 * 3, 4 * 3))).toBe(true);
  });
});

describe("A8 paintDrawingPng: rejection and no image loading", () => {
  it("A8 returns null for markup the sanitizer rejects", () => {
    const bad = [
      svgOf("<script>alert(1)</script>"),
      svgOf('<rect x="1" y="1" width="3" height="3" onclick="x()"/>'),
      svgOf('<rect x="1" y="1" width="3" height="3" style="fill:red"/>'),
      svgOf('<use href="https://evil.example/x.svg#a"/>'),
      svgOf('<image href="https://evil.example/x.png" width="5" height="5"/>'),
      svgOf('<foreignObject width="5" height="5"/>'),
      "not svg",
    ];
    for (const svg of bad) expect([svg, paintDrawingPng(svg, factory())]).toEqual([svg, null]);
  });

  it("A8 paints without creating or drawing an image", async () => {
    const g = globalThis as unknown as { Image?: unknown; createImageBitmap?: unknown };
    const savedImage = g.Image;
    const savedBitmap = g.createImageBitmap;
    let imageUsed = false;
    g.Image = class { constructor() { imageUsed = true; throw new Error("Image must not be created"); } };
    g.createImageBitmap = () => { imageUsed = true; throw new Error("createImageBitmap must not be called"); };
    const createElement = jest.spyOn(document, "createElement");
    let drawImageCalled = false;
    const guarded: CanvasFactory = {
      create(width, height) {
        const inner = factory().create(width, height);
        return {
          getContext: (kind: "2d") => {
            const ctx = inner.getContext(kind);
            if (ctx) (ctx as unknown as { drawImage: () => void }).drawImage = () => { drawImageCalled = true; };
            return ctx;
          },
          toDataURL: (type: "image/png") => inner.toDataURL(type),
        };
      },
    };
    try {
      const url = paintDrawingPng(svgOf('<defs><path id="p" d="M0 0L4 4"/></defs><use href="#p"/><rect x="1" y="1" width="5" height="5" fill="currentColor"/>'), guarded);
      expect(url?.startsWith("data:image/png;base64,")).toBe(true);
      expect(imageUsed).toBe(false);
      expect(drawImageCalled).toBe(false);
      expect(createElement.mock.calls.filter(([tag]) => /^(img|image)$/i.test(String(tag)))).toEqual([]);
    } finally {
      g.Image = savedImage;
      g.createImageBitmap = savedBitmap;
      createElement.mockRestore();
    }
  });
});

describe("A3 paintDrawingPng: same geometry as the SVG", () => {
  const measure = (): LabelBox => ({ width: 40, height: 20 });
  const emptyLabel = () => `<svg ${NS} width="1" height="1"></svg>`;
  type Model = Parameters<typeof layoutDrawing>[0];
  const seg = (a: string, b: string) => ({ k: "seg", a, b, arrow: "none" });

  const xy = (v: unknown): [number, number] => (Array.isArray(v) ? [Number(v[0]), Number(v[1])] : [(v as { x: number }).x, (v as { y: number }).y]);

  it("A3 paints a triangle with the extent the layout gives, at 18.9 px per unit and 3x", async () => {
    const m = { v: 1, points: [{ id: "a", x: 0, y: 0, dot: false }, { id: "b", x: 6, y: 0, dot: false }, { id: "c", x: 3, y: 5, dot: false }], items: [seg("a", "b"), seg("b", "c"), seg("c", "a")] } as unknown as Model;
    const layout = layoutDrawing(m, measure);
    const svg = formatDrawingSvg(m, layout, emptyLabel);
    const box = inkBox(await paint(svg));
    expect((box.x1 - box.x0) / 3 / 18.9).toBeCloseTo(6, 0);
    expect((box.y1 - box.y0) / 3 / 18.9).toBeCloseTo(5, 0);
  });

  it("A3 paints segments shortened at a labelled dot-less vertex exactly as the layout shortens them", async () => {
    const m = { v: 1, points: [{ id: "a", x: 0, y: 0, dot: false }, { id: "b", x: 6, y: 0, dot: false }, { id: "c", x: 3, y: 5, dot: false, label: "C" }], items: [seg("a", "b"), seg("b", "c"), seg("c", "a")] } as unknown as Model;
    const layout = layoutDrawing(m, measure);
    const ys = [...layout.segments.values()].flatMap((s) => [xy(s.from)[1], xy(s.to)[1]]);
    const expectedHeight = Math.max(...ys) - Math.min(...ys);
    expect(expectedHeight).toBeLessThan(5);
    const svg = formatDrawingSvg(m, layout, emptyLabel);
    const box = inkBox(await paint(svg));
    expect((box.y1 - box.y0) / 3 / 18.9).toBeCloseTo(expectedHeight, 0);
  });
});
