// Pins the width and fig-align attributes of images and figure blocks: reading, writing and the byte-exact round trip of both forms.
import { Fragment } from "prosemirror-model";
import { emptyFigure, formatFigureBlock, readFigureBlock } from "../../../src/qmd/chart/index";
import { carryFigureAttributes, cssWidth, figureAttributes, readAttrAlign, readAttrWidth, setAttrAlign, setAttrWidth, setFigureAlign, setFigureWidth } from "../../../src/qmd/editor/mediaWidth";
import { bodyToDoc, docToBody } from "../../../src/qmd/editor/qmdDoc";
import { parseInline, serializeInline } from "../../../src/qmd/editor/qmdInline";

const PNG = { dataUrl: "data:image/png;base64,iVBORw0KGgo=", widthCm: 12, alt: "A figure" };
const figure = (): string => formatFigureBlock({ model: { ...emptyFigure("plot", "0a1b2c3d"), fns: [{ kind: "y", expr: ["sin(x)"] }] }, png: PNG, picture: null, svg: null })!;

describe("width attribute", () => {
  it("reads width= among other attributes, quoted or not", () => {
    expect(readAttrWidth("#fig-a width=60% .wide")).toBe("60%");
    expect(readAttrWidth('fig-alt="a b" width="3in"')).toBe("3in");
    expect(readAttrWidth("#fig-a")).toBeNull();
    expect(readAttrWidth(null)).toBeNull();
  });

  it("sets, replaces and removes width= keeping the other bytes", () => {
    expect(setAttrWidth("", "60%")).toBe("width=60%");
    expect(setAttrWidth("#fig-a  .x", "60%")).toBe("#fig-a  .x width=60%");
    expect(setAttrWidth("#fig-a width=300px .x", "40%")).toBe("#fig-a width=40% .x");
    expect(setAttrWidth("#fig-a width=40% .x", null)).toBe("#fig-a .x");
    expect(setAttrWidth("width=40% .x", null)).toBe(".x");
    expect(setAttrWidth("width=40%", null)).toBe("");
  });

  it("reads fig-align, quoted or not, with centre for none or an unknown value", () => {
    expect(readAttrAlign('#fig-a width=60% fig-align="left"')).toBe("left");
    expect(readAttrAlign("fig-align=right")).toBe("right");
    expect(readAttrAlign('fig-align="middle"')).toBe("center");
    expect(readAttrAlign("#fig-a")).toBe("center");
    expect(readAttrAlign(null)).toBe("center");
  });

  it("sets fig-align beside width and removes it for centre, keeping the other bytes", () => {
    expect(setAttrAlign("#fig-a width=60%", "left")).toBe('#fig-a width=60% fig-align="left"');
    expect(setAttrAlign('#fig-a fig-align="left" width=60%', "right")).toBe('#fig-a fig-align="right" width=60%');
    expect(setAttrAlign('#fig-a fig-align="left" width=60%', "center")).toBe("#fig-a width=60%");
    expect(setAttrAlign("", "center")).toBe("");
    expect(setAttrWidth('fig-align="left"', "50%")).toBe('fig-align="left" width=50%');
  });

  it("turns width values into CSS widths", () => {
    expect(cssWidth("60%")).toBe("60%");
    expect(cssWidth("2.5in")).toBe("2.5in");
    expect(cssWidth("300")).toBe("300px");
    expect(cssWidth("wide")).toBeNull();
    expect(cssWidth(null)).toBeNull();
  });
});

describe("image width", () => {
  const roundTrip = (text: string): string => serializeInline(Fragment.from(parseInline(text)));

  it.each([
    "![a](assets/x.png)",
    "![a](assets/x.png){width=60%}",
    "![a](assets/x.png){width=300px}",
    'See ![a](x.png){#fig-a width="2in" fig-alt="A } b"} after.',
    "![a](x.png){}",
    "![a](x.png){unclosed",
  ])("round trips %j byte for byte", (text) => {
    expect(roundTrip(text)).toBe(text);
  });

  it("reads the attribute block into the image", () => {
    const [image] = parseInline("![a](x.png){#fig-a width=300px}");
    expect(image?.type.name).toBe("image");
    expect(image?.attrs.attributes).toBe("#fig-a width=300px");
    expect(readAttrWidth(image?.attrs.attributes as string)).toBe("300px");
    expect(parseInline("![a](x.png)")[0]?.attrs.attributes).toBeNull();
  });

  it("writes a new width into the attribute block", () => {
    const [image] = parseInline("![a](x.png){#fig-a width=300px}");
    const sized = image!.type.create({ ...image!.attrs, attributes: setAttrWidth(image!.attrs.attributes as string, "60%") });
    expect(serializeInline(Fragment.from(sized))).toBe("![a](x.png){#fig-a width=60%}");
  });
});

describe("figure width", () => {
  it("reads a figure whose opener holds a width and other attributes", () => {
    const block = figure();
    const sized = setFigureWidth(block, "60%");
    expect(sized.split("\n")[0]).toMatch(/^::: \{\.labshelf-figure source=[0-9a-f]+ width=60%\}$/);
    expect(readFigureBlock(sized)).toMatchObject({ handEdited: false });
    expect(readAttrWidth(figureAttributes(sized))).toBe("60%");
    expect(setFigureWidth(sized, null)).toBe(block);
    const aligned = setFigureAlign(sized, "right");
    expect(aligned.split("\n")[0]).toMatch(/ width=60% fig-align="right"\}$/);
    expect(readAttrAlign(figureAttributes(aligned))).toBe("right");
    expect(readFigureBlock(aligned)).toMatchObject({ handEdited: false });
    expect(setFigureAlign(aligned, "center")).toBe(sized);
    const labelled = sized.replace("}\n", " #fig-a}\n");
    expect(readFigureBlock(labelled)?.handEdited).toBe(false);
  });

  it("round trips a body with sized and unsized figures byte for byte", () => {
    const block = figure();
    const body = `Text\n\n${setFigureWidth(block, "3in")}\n\n${block}\n`;
    const doc = bodyToDoc(body);
    expect(doc.child(1).type.name).toBe("figure");
    expect(doc.child(2).type.name).toBe("figure");
    expect(docToBody(doc)).toBe(body);
  });

  it("keeps the opener's other attributes when the editor rewrites the block", () => {
    const old = setFigureWidth(figure(), "50%").replace("}\n", " #fig-a}\n");
    const next = formatFigureBlock({ model: { ...emptyFigure("plot", "0a1b2c3d"), fns: [{ kind: "y", expr: ["cos(x)"] }] }, png: PNG, picture: null, svg: null })!;
    const carried = carryFigureAttributes(old, next);
    expect(figureAttributes(carried)).toBe(`${figureAttributes(next)!} width=50% #fig-a`);
    expect(readFigureBlock(carried)?.handEdited).toBe(false);
    expect(carryFigureAttributes("", next)).toBe(next);
  });
});
