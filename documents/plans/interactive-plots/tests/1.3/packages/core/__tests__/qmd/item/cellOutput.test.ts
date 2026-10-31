import { parseItemFile, type ItemSegment } from "../../../src/qmd/item/itemFile";
import {
  deriveCodeHash,
  findOutputs,
  formatOutput,
  formatPlotContent,
  readOutputImage,
  readOutputPlot,
} from "../../../src/qmd/item/cellOutput";
import { bodyToDoc, docToBody } from "../../../src/qmd/editor/qmdDoc";
import { formatPlotSpec, parsePlotSpec, type PlotSpec } from "../../../src/qmd/plot/plotSpec";
import { readQmdFixture } from "../fixtures/qmdFixtures";

describe("outputBlock", () => {
  it("finds the output block of a cell with its attributes and offsets", () => {
    const item = parseItemFile(readQmdFixture("cell-output.qmd")).segments[0] as ItemSegment;
    const [output] = findOutputs(item.body);
    expect(output).toMatchObject({
      cell: "bound",
      source: "3f9a1c0b7d2e",
      engine: "python-3.12 sympy-1.13",
      ran: "2026-10-22T09:15:03.000Z",
      content: "$$\\sqrt{\\pi}$$\n",
    });
    expect(item.body.slice(output!.start, output!.end)).toBe(
      '::: {.labshelf-output cell="bound" source="3f9a1c0b7d2e" engine="python-3.12 sympy-1.13" ran="2026-10-22T09:15:03.000Z"}\n$$\\sqrt{\\pi}$$\n:::\n',
    );
  });

  it("ignores a block without cell or source and one inside a code fence", () => {
    const body = "::: {.labshelf-output cell=\"a\"}\nx\n:::\n```\n::: {.labshelf-output cell=\"b\" source=\"0123456789ab\"}\n:::\n```\n";
    expect(findOutputs(body)).toEqual([]);
  });

  it("refuses content that would end the block early", () => {
    expect(() => formatOutput({ cell: "c", source: "0123456789ab", engine: "python-3.12", ran: "r", content: "a\n:::\nb" })).toThrow(/cell c/);
  });

  it("writes a block that it reads back", () => {
    const block = formatOutput({ cell: "c", source: "0123456789ab", engine: "python-3.12", ran: "2026-10-22T09:15:03.000Z", content: "a\r\nb" }, "\r\n");
    expect(block).toBe('::: {.labshelf-output cell="c" source="0123456789ab" engine="python-3.12" ran="2026-10-22T09:15:03.000Z"}\r\na\r\nb\r\n:::\r\n');
    expect(findOutputs(block)).toEqual([
      { cell: "c", source: "0123456789ab", engine: "python-3.12", ran: "2026-10-22T09:15:03.000Z", content: "a\r\nb\r\n", start: 0, end: block.length },
    ]);
  });
});

describe("deriveCodeHash", () => {
  it("is the first 12 hex characters of the SHA-256 of the code without option lines", async () => {
    expect(await deriveCodeHash("x = 1")).toBe("8ff436def145");
    expect(await deriveCodeHash("#| label: a\nx = 1\n\n")).toBe("8ff436def145");
  });

  it("does not depend on line endings but does on the code", async () => {
    expect(await deriveCodeHash("a = 1\r\nb = 2\r\n")).toBe(await deriveCodeHash("a = 1\nb = 2"));
    expect(await deriveCodeHash("a = 1\nb = 3")).not.toBe(await deriveCodeHash("a = 1\nb = 2"));
  });
});

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const IMAGE = { alt: "Python plot", src: PNG };
const IMAGE_LINE = `![Python plot](${PNG})`;
const FENCE = "```{=labshelf-plot}";

function specOf(json: string): PlotSpec {
  const spec = parsePlotSpec(json);
  if (!spec) { throw new Error("test spec is invalid"); }
  return spec;
}

const LINE_SPEC = specOf('{"v":1,"dim":2,"title":"decay","axes":{"x":{"label":"t"},"y":{"label":"N"}},"traces":[{"type":"line","name":"a","x":[0,1,2,3],"y":[4,2,null,1]}]}');
const SURFACE_SPEC = specOf('{"v":1,"dim":3,"axes":{"x":{},"y":{},"z":{}},"traces":[{"type":"surface","x":[0,1],"y":[0,1,2],"z":[[0,1],[1,2],[2,3]]}]}');
const LINE_JSON = formatPlotSpec(LINE_SPEC) as string;

function plotBlock(content: string, eol = "\n"): string {
  return formatOutput({ cell: "bound", source: "3f9a1c0b7d2e", engine: "python-3.12", ran: "2026-10-22T09:15:03.000Z", content }, eol);
}

function itemBody(block: string): string {
  return "```{python}\n#| label: bound\nplot(x)\n```\n\n" + block;
}

function oversizedSpec(): PlotSpec {
  const traces = Array.from({ length: 24 }, (_, k) => {
    const x = Array.from({ length: 2000 }, (_, i) => Number((i * 0.37 + k).toPrecision(4)));
    const y = Array.from({ length: 2000 }, (_, i) => Number((Math.sin(i * 1.7 + k) * 1000 + i).toPrecision(4)));
    return { type: "line" as const, x, y };
  });
  return { v: 1, dim: 2, axes: { x: {}, y: {} }, traces };
}

describe("plot content", () => {
  it("1.3a writes the image line, one blank line, the fence, one line of spec JSON and the closing fence", () => {
    expect(formatPlotContent(IMAGE, LINE_SPEC)).toBe(`${IMAGE_LINE}\n\n${FENCE}\n${LINE_JSON}\n\`\`\`\n`);
  });

  it("1.3a writes spec-only content without an image line or blank line", () => {
    expect(formatPlotContent(null, LINE_SPEC)).toBe(`${FENCE}\n${LINE_JSON}\n\`\`\`\n`);
  });

  it.each([
    ["2D line", LINE_SPEC],
    ["3D surface", SURFACE_SPEC],
  ])("1.3a reads back the image and the %s spec it wrote", (_name, spec) => {
    expect(readOutputPlot(formatPlotContent(IMAGE, spec))).toEqual({ image: IMAGE, spec });
  });

  it("1.3a reads spec-only content with image null", () => {
    expect(readOutputPlot(formatPlotContent(null, LINE_SPEC))).toEqual({ image: null, spec: LINE_SPEC });
  });

  it("1.3a reads an image with a custom alt text back unchanged", () => {
    const image = { alt: "damped sine", src: PNG };
    expect(readOutputPlot(formatPlotContent(image, LINE_SPEC))?.image).toEqual(image);
  });

  it("1.3a reads CRLF content, surrounding whitespace and extra blank lines", () => {
    const crlf = formatPlotContent(IMAGE, LINE_SPEC).replace(/\n/g, "\r\n");
    expect(readOutputPlot(crlf)).toEqual({ image: IMAGE, spec: LINE_SPEC });
    const loose = `\n  ${IMAGE_LINE}  \n\n\n\n${FENCE}\n${LINE_JSON}\n\`\`\`\n\n\n`;
    expect(readOutputPlot(loose)).toEqual({ image: IMAGE, spec: LINE_SPEC });
  });

  it("1.3a gives null for content that holds anything besides the image and one plot fence", () => {
    const fenced = `${FENCE}\n${LINE_JSON}\n\`\`\`\n`;
    expect(readOutputPlot("")).toBeNull();
    expect(readOutputPlot(`${IMAGE_LINE}\n`)).toBeNull();
    expect(readOutputPlot(`${IMAGE_LINE}\n\n${IMAGE_LINE}\n\n${fenced}`)).toBeNull();
    expect(readOutputPlot(`some text\n\n${fenced}`)).toBeNull();
    expect(readOutputPlot(`${IMAGE_LINE}\n\n${fenced}\ntrailing text\n`)).toBeNull();
    expect(readOutputPlot(`${IMAGE_LINE}\n\n${fenced}\n${fenced}`)).toBeNull();
    expect(readOutputPlot(`${IMAGE_LINE}\n\n\`\`\`\n${LINE_JSON}\n\`\`\`\n`)).toBeNull();
    expect(readOutputPlot(`$$x$$\n`)).toBeNull();
  });

  it("1.3a still reads an image-only output with readOutputImage", () => {
    expect(readOutputImage(`${IMAGE_LINE}\n`)).toEqual(IMAGE);
    expect(readOutputImage("$$x$$\n")).toBeNull();
  });

  it("1.3a reads the image of image plus plot content with readOutputImage", () => {
    expect(readOutputImage(formatPlotContent(IMAGE, LINE_SPEC))).toEqual(IMAGE);
  });
});

describe("plot output block", () => {
  it("A1 round-trips a block with PNG plus plot fence byte for byte through findOutputs and formatOutput", () => {
    const content = formatPlotContent(IMAGE, LINE_SPEC);
    const block = plotBlock(content);
    const [output, ...rest] = findOutputs(block);
    expect(rest).toEqual([]);
    expect(output).toMatchObject({ cell: "bound", source: "3f9a1c0b7d2e", content });
    expect(output!.start).toBe(0);
    expect(output!.end).toBe(block.length);
    const again = formatOutput({ cell: output!.cell, source: output!.source, engine: output!.engine!, ran: output!.ran!, content: output!.content });
    expect(again).toBe(block);
    expect(readOutputPlot(output!.content)).toEqual({ image: IMAGE, spec: LINE_SPEC });
  });

  it("1.3b round-trips a spec-only block through findOutputs", () => {
    const content = formatPlotContent(null, SURFACE_SPEC);
    const block = plotBlock(content);
    const [output] = findOutputs(block);
    expect(output!.content).toBe(content);
    expect(readOutputPlot(output!.content)).toEqual({ image: null, spec: SURFACE_SPEC });
  });

  it("1.3b round-trips a CRLF block through findOutputs and formatOutput", () => {
    const content = formatPlotContent(IMAGE, LINE_SPEC);
    const block = plotBlock(content, "\r\n");
    expect(block).toContain(`${FENCE}\r\n`);
    const [output] = findOutputs(block);
    expect(readOutputPlot(output!.content)).toEqual({ image: IMAGE, spec: LINE_SPEC });
    expect(formatOutput({ cell: output!.cell, source: output!.source, engine: output!.engine!, ran: output!.ran!, content: output!.content }, "\r\n")).toBe(block);
  });

  it("1.3b keeps the plot block inside an item as one balanced item segment", () => {
    const block = plotBlock(formatPlotContent(IMAGE, LINE_SPEC));
    const text = `::: {#n-01JB2QB0000000000000000000 .labshelf-item created="2026-10-22T09:15:00.000Z"}\n${itemBody(block)}:::\n`;
    const segments = parseItemFile(text).segments;
    expect(segments.map((s) => s.kind)).toEqual(["item"]);
    const item = segments[0] as ItemSegment;
    expect(item.body).toBe(itemBody(block));
    expect(findOutputs(item.body)).toHaveLength(1);
  });

  it.each([
    ["LF", "\n"],
    ["CRLF", "\r\n"],
  ])("1.3b round-trips a body with the plot block (%s) byte for byte through the editor", (_name, eol) => {
    const block = plotBlock(formatPlotContent(IMAGE, LINE_SPEC), eol);
    const body = itemBody(block).replace(/\r?\n/g, eol);
    const doc = bodyToDoc(body);
    expect(() => doc.check()).not.toThrow();
    expect(doc.lastChild!.type.name).toBe("output");
    expect(docToBody(doc)).toBe(body);
  });

  it("1.3b round-trips a spec-only plot block through the editor", () => {
    const body = itemBody(plotBlock(formatPlotContent(null, SURFACE_SPEC)));
    expect(docToBody(bodyToDoc(body))).toBe(body);
  });
});

describe("plot content fallbacks", () => {
  it("A1 drops an oversized spec and keeps the PNG", () => {
    const spec = oversizedSpec();
    expect(formatPlotSpec(spec)).toBeNull();
    expect(formatPlotContent(IMAGE, spec)).toBe(`${IMAGE_LINE}\n`);
  });

  it("1.3c writes empty content for an oversized spec without an image", () => {
    expect(formatPlotContent(null, oversizedSpec())).toBe("");
  });

  it("A1 reads the PNG of dropped-spec content with readOutputImage and no plot with readOutputPlot", () => {
    const content = formatPlotContent(IMAGE, oversizedSpec());
    expect(readOutputImage(content)).toEqual(IMAGE);
    expect(readOutputPlot(content)).toBeNull();
  });

  it.each([
    ["JSON that does not parse", "{not json"],
    ["a wrong version", '{"v":2,"dim":2,"axes":{"x":{},"y":{}},"traces":[{"type":"line","x":[0],"y":[0]}]}'],
    ["an empty trace list", '{"v":1,"dim":2,"axes":{"x":{},"y":{}},"traces":[]}'],
    ["a value that is not JSON object", "[1,2,3]"],
  ])("1.3c gives readOutputPlot null and readOutputImage the PNG for %s", (_name, json) => {
    const content = `${IMAGE_LINE}\n\n${FENCE}\n${json}\n\`\`\`\n`;
    expect(readOutputPlot(content)).toBeNull();
    expect(readOutputImage(content)).toEqual(IMAGE);
  });

  it("1.3c gives readOutputPlot null for a bad spec without an image", () => {
    expect(readOutputPlot(`${FENCE}\n{"v":2}\n\`\`\`\n`)).toBeNull();
  });
});
