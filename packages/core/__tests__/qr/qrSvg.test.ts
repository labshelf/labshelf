// QR SVG writer: one line, viewBox with margin, a white rect, one black path of unit squares, an escaped aria-label, no style.
import { formatQrSvg } from "../../src/qr/qrSvg";

/** 3x3 diagonal plus one more dark module: dark at (row 0, col 0), (1, 1), (2, 2) and (0, 2). */
const MATRIX: boolean[][] = [
  [true, false, true],
  [false, true, false],
  [false, false, true],
];
const SHAPE = /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 (\d+) (\d+)" shape-rendering="crispEdges" role="img" aria-label="([^"]*)"><rect width="(\d+)" height="(\d+)" fill="#fff"\/><path fill="#000" d="([^"]*)"\/><\/svg>$/;
const SQUARE = /M(\d+) (\d+)h1v1h-1z/g;

function parse(svg: string): { n: number; label: string; squares: string[]; leftover: string } {
  const match = SHAPE.exec(svg);
  if (!match) throw new Error(`svg does not have the expected shape: ${svg}`);
  const [, w, h, label, rw, rh, d] = match;
  expect([h, rw, rh]).toEqual([w, w, w]);
  const squares = [...d!.matchAll(SQUARE)].map(([, x, y]) => `${x},${y}`).sort();
  return { n: Number(w), label: label!, squares, leftover: d!.replace(SQUARE, "").trim() };
}

const unescape = (value: string) =>
  value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;|&#34;|&#x22;/g, '"')
    .replace(/&apos;|&#39;|&#x27;/g, "'")
    .replace(/&amp;/g, "&");

describe("formatQrSvg", () => {
  it("3.2e writes one line with the svg, rect, path and closing tag in order", () => {
    const svg = formatQrSvg(MATRIX);
    expect(svg).not.toMatch(/[\r\n]/);
    expect(svg).toMatch(SHAPE);
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 11 11" shape-rendering="crispEdges" role="img" aria-label="QR code">')).toBe(true);
    expect(svg).toContain('<rect width="11" height="11" fill="#fff"/>');
    expect(svg.endsWith("</svg>")).toBe(true);
  });

  it("3.2e uses a default margin of 4 modules in the viewBox and the module coordinates", () => {
    const { n, squares, leftover } = parse(formatQrSvg(MATRIX));
    expect(n).toBe(3 + 2 * 4);
    expect(squares).toEqual(["4,4", "5,5", "6,4", "6,6"]);
    expect(leftover).toBe("");
  });

  it("3.2e honours an explicit margin", () => {
    const zero = parse(formatQrSvg(MATRIX, { margin: 0 }));
    expect(zero.n).toBe(3);
    expect(zero.squares).toEqual(["0,0", "1,1", "2,0", "2,2"]);
    const two = parse(formatQrSvg(MATRIX, { margin: 2 }));
    expect(two.n).toBe(7);
    expect(two.squares).toEqual(["2,2", "3,3", "4,2", "4,4"]);
  });

  it("3.2e draws exactly one path with one unit square per dark module, x as column and y as row", () => {
    const matrix = Array.from({ length: 21 }, (_, r) => Array.from({ length: 21 }, (_, c) => (r * 7 + c * 3) % 5 === 0));
    const svg = formatQrSvg(matrix);
    expect(svg.match(/<path/g)).toHaveLength(1);
    const { n, squares, leftover } = parse(svg);
    expect(n).toBe(29);
    const expected: string[] = [];
    matrix.forEach((row, r) => row.forEach((dark, c) => dark && expected.push(`${c + 4},${r + 4}`)));
    expect(squares).toEqual(expected.sort());
    expect(leftover).toBe("");
  });

  it("3.2e labels the image with aria-label, default QR code", () => {
    expect(parse(formatQrSvg(MATRIX)).label).toBe("QR code");
    expect(parse(formatQrSvg(MATRIX, { label: "Share link" })).label).toBe("Share link");
  });

  it("3.2e escapes the label", () => {
    const label = `Talk & "Q" <1> 'x'`;
    const svg = formatQrSvg(MATRIX, { label });
    const { label: written } = parse(svg);
    expect(written).not.toMatch(/[<"]/);
    expect(written).not.toMatch(/&(?!(amp|lt|gt|quot|apos|#34|#39|#x22|#x27);)/);
    expect(unescape(written)).toBe(label);
  });

  it("3.2e writes no style attribute", () => {
    for (const svg of [formatQrSvg(MATRIX), formatQrSvg(MATRIX, { margin: 1, label: "style" })]) {
      expect(svg).not.toMatch(/\sstyle=/);
      expect(svg).not.toMatch(/<style/);
    }
  });
});
