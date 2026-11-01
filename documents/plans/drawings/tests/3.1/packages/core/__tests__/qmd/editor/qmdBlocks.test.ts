/**
 * Tests that a stored drawing block (plan drawings, D1) reads as an atom `drawing` node that keeps its exact bytes,
 * that every shape readDrawingBlock rejects stays a raw block, and that all of it writes back byte for byte.
 */
import { createHash } from "node:crypto";
import type { Node as PmNode } from "prosemirror-model";
import { parseItemFile, serializeItemFile } from "../../../src/qmd/item/itemFile";
import { bodyToDoc, docToBody } from "../../../src/qmd/editor/qmdDoc";
import { qmdSchema as s } from "../../../src/qmd/editor/qmdSchema";

const TIKZ = [
  "\\begin{tikzpicture}[x=0.5cm,y=0.5cm,>=stealth,line width=0.6pt]",
  "\\coordinate (pp1) at (0,0);",
  "\\coordinate (pp2) at (6,0);",
  "\\draw[->] (pp1) -- (pp2);",
  "\\end{tikzpicture}",
].join("\n");
const MODEL = '{"v":1,"points":[{"id":"p1","x":0,"y":0,"dot":true},{"id":"p2","x":6,"y":0,"dot":true}],"items":[{"k":"seg","a":"p1","b":"p2","arrow":"end"}]}';
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10" viewBox="0 0 20 10"><line x1="0" y1="0" x2="10" y2="5" stroke="currentColor"/></svg>';
const PNG = "iVBORw0KGgoAAAANSUhEUgAAACgAAAAUCAIAAABwJOjsAAAAJElEQVR4nGNoaPg/IIhh1OJRi0ctHrV41OJRi0ctHrV45FgMAPGJPTtbDo1MAAAAAElFTkSuQmCC";

const hashOf = (tikz: string): string => createHash("sha256").update(tikz, "utf8").digest("hex").slice(0, 12);

interface Parts { guard: string; png: string; fi: string; svg: string; model: string }

/** The five parts of D1 in order, each as the text between the blank lines of the stored block. */
function parts(tikz = TIKZ, png = PNG, model = MODEL): Parts {
  return {
    guard: `\`\`\`{=latex}\n\\makeatletter\\@ifundefined{tikzpicture}{\\iftrue}{${tikz}\\iffalse}\\makeatother\n\`\`\``,
    png: `![](data:image/png;base64,${png}){fig-alt="Drawing"}`,
    fi: "```{=latex}\n\\fi\n```",
    svg: `\`\`\`{=labshelf-svg}\n${SVG}\n\`\`\``,
    model: `\`\`\`{=labshelf-drawing}\n${model}\n\`\`\``,
  };
}

/** A whole stored block, ending with a newline. */
function block(p: Parts = parts(), source = hashOf(TIKZ)): string {
  return `::: {.labshelf-drawing source=${source}}\n${[p.guard, p.png, p.fi, p.svg, p.model].join("\n\n")}\n:::\n`;
}

const withEol = (text: string, eol: string): string => text.replace(/\n/g, eol);
const types = (doc: PmNode): string[] => doc.content.content.map((node) => node.type.name);
const exact = (body: string): PmNode => {
  const doc = bodyToDoc(body);
  expect(() => doc.check()).not.toThrow();
  expect(docToBody(doc)).toBe(body);
  return doc;
};
/** Round trip of a body that holds at least one drawing node. */
const roundTrips = (body: string): void => {
  expect(types(exact(body))).toContain("drawing");
};

describe("drawing block reading", () => {
  it("A1 reads a top-level drawing block as one atom drawing node holding its exact bytes", () => {
    const drawing = block();
    const doc = bodyToDoc(`Before.\n\n${drawing}\nAfter.\n`);
    expect(types(doc)).toEqual(["paragraph", "drawing", "paragraph"]);
    const node = doc.child(1);
    expect(node.isAtom).toBe(true);
    expect(node.attrs.raw).toBe(drawing);
  });

  it("A1 keeps the blank lines before a drawing in its gap, not in raw", () => {
    const drawing = block();
    const doc = bodyToDoc(`Before.\n\n\n\n${drawing}`);
    const node = doc.child(1);
    expect(node.type.name).toBe("drawing");
    expect(node.attrs.gap).toBe("\n\n\n");
    expect(node.attrs.raw).toBe(drawing);
  });

  it("A1 reads a drawing block that is the whole body", () => {
    expect(types(bodyToDoc(block()))).toEqual(["drawing"]);
  });

  it("A1 reads two drawing blocks in a row as two nodes", () => {
    const doc = bodyToDoc(`${block()}\n${block()}`);
    expect(types(doc)).toEqual(["drawing", "drawing"]);
  });

  it("A1 reads a drawing block whose parts follow each other without blank lines", () => {
    const p = parts();
    const tight = `::: {.labshelf-drawing source=${hashOf(TIKZ)}}\n${[p.guard, p.png, p.fi, p.svg, p.model].join("\n")}\n:::\n`;
    const doc = bodyToDoc(tight);
    expect(types(doc)).toEqual(["drawing"]);
    expect(docToBody(doc)).toBe(tight);
  });

  it("A1 reads a block whose source no longer matches its TikZ as a drawing node, since the view shows that state", () => {
    const doc = bodyToDoc(block(parts(TIKZ.replace("(6,0)", "(7,0)")), hashOf(TIKZ)));
    expect(types(doc)).toEqual(["drawing"]);
  });

  it("A1 gives the drawing node the text of its raw bytes as leaf text", () => {
    const drawing = block();
    const doc = bodyToDoc(drawing);
    expect(types(doc)).toEqual(["drawing"]);
    expect(doc.textBetween(0, doc.content.size)).toBe(drawing);
  });

  it("A1 reads a drawing block inside an item body", () => {
    const drawing = block();
    const file = `::: {#n1 .labshelf-item author="a" created="2026-11-01T10:00:00.000Z"}\nText.\n\n${drawing}:::\n`;
    const item = parseItemFile(file).segments.find((segment) => segment.kind === "item");
    expect(item).toBeDefined();
    const body = item!.kind === "item" ? item!.body : "";
    const doc = bodyToDoc(body);
    expect(types(doc)).toEqual(["paragraph", "drawing"]);
    expect(docToBody(doc)).toBe(body);
    expect(serializeItemFile(parseItemFile(file))).toBe(file);
  });
});

describe("drawing block round trip", () => {
  it("A1 writes a note with drawings back byte for byte", () => {
    roundTrips(`# Title\n\nBefore.\n\n${block()}\nMiddle $x^2$.\n\n${block()}\n- list\n- items\n`);
  });

  it("A1 round-trips a CRLF body with a CRLF drawing and keeps the CRLF in raw", () => {
    const drawing = withEol(block(), "\r\n");
    const body = withEol(`Before.\n\n`, "\r\n") + drawing + withEol(`\nAfter.\n`, "\r\n");
    const doc = bodyToDoc(body);
    expect(types(doc)).toEqual(["paragraph", "drawing", "paragraph"]);
    expect(doc.attrs.eol).toBe("\r\n");
    expect(doc.child(1).attrs.raw).toBe(drawing);
    expect(docToBody(doc)).toBe(body);
  });

  it("A1 round-trips a drawing block with a missing final newline", () => {
    const body = `Before.\n\n${block().slice(0, -1)}`;
    const doc = bodyToDoc(body);
    expect(types(doc)).toEqual(["paragraph", "drawing"]);
    expect(docToBody(doc)).toBe(body);
  });

  it("A1 round-trips a CRLF drawing block with a missing final newline", () => {
    const body = withEol(block(), "\r\n").slice(0, -2);
    const doc = bodyToDoc(body);
    expect(types(doc)).toEqual(["drawing"]);
    expect(docToBody(doc)).toBe(body);
  });

  it("A1 round-trips a body that starts with a byte order mark before a drawing", () => {
    roundTrips(`﻿${block()}`);
    roundTrips(`﻿Text.\n\n${block()}`);
  });

  it("A1 round-trips an item file with a byte order mark and drawings in its items", () => {
    const file = `﻿Loose.\n\n::: {#n1 .labshelf-item author="a" created="2026-11-01T10:00:00.000Z"}\n${block()}:::\n\n::: {#n2 .labshelf-item author="a" created="2026-11-01T10:05:00.000Z"}\nText.\n\n${block()}:::\n`;
    const parsed = parseItemFile(file);
    expect(serializeItemFile(parsed)).toBe(file);
    const bodies = parsed.segments.flatMap((segment) => (segment.kind === "item" ? [segment.body] : []));
    expect(bodies).toHaveLength(2);
    for (const body of bodies) {
      expect(types(bodyToDoc(body))).toContain("drawing");
      roundTrips(body);
    }
  });

  it("A1 round-trips drawings with extra blank lines and trailing blank lines around them", () => {
    roundTrips(`\n\n${block()}\n\n\n${block()}\n\n`);
  });

  it("A1 writes a replaced drawing's raw back exactly, with the file's line ending", () => {
    const eol = "\r\n";
    const raw = withEol(block(parts(TIKZ.replace("(6,0)", "(9,0)"), PNG, MODEL.replace('"x":6', '"x":9'))), eol);
    const doc = s.node("doc", { eol, trailing: "", unterminated: false }, [
      s.node("paragraph", null, [s.text("Before.")]),
      s.node("drawing", { raw, gap: eol + eol }),
    ]);
    expect(() => doc.check()).not.toThrow();
    expect(docToBody(doc)).toBe(`Before.${eol}${eol}${raw}`);
    expect(docToBody(bodyToDoc(docToBody(doc)))).toBe(docToBody(doc));
  });
});

describe("drawing block rejection", () => {
  const rejected = (name: string, body: string) => {
    // A valid drawing follows, so the test also shows the reader tells the two apart.
    it(`A1 keeps ${name} as a raw block, writes it back byte for byte, and still reads the drawing after it`, () => {
      const eol = body.includes("\r\n") ? "\r\n" : "\n";
      const whole = body + eol + withEol(block(), eol);
      const doc = exact(whole);
      expect(types(doc)).toEqual(["raw_block", "drawing"]);
    });
  };
  const without = (key: keyof Parts): Parts => ({ ...parts(), [key]: undefined as unknown as string });
  const join = (p: Partial<Record<keyof Parts, string | undefined>>, order: Array<keyof Parts> = ["guard", "png", "fi", "svg", "model"]): string =>
    `::: {.labshelf-drawing source=${hashOf(TIKZ)}}\n${order.map((key) => p[key]).filter((part) => part !== undefined).join("\n\n")}\n:::\n`;

  rejected("a div missing its guard fence", join(without("guard")));
  rejected("a div missing its PNG", join(without("png")));
  rejected("a div missing its \\fi fence", join(without("fi")));
  rejected("a div missing its SVG fence", join(without("svg")));
  rejected("a div missing its model fence", join(without("model")));
  rejected("a div with the SVG and the model out of order", join(parts(), ["guard", "png", "fi", "model", "svg"]));
  rejected("a div with the PNG before the guard", join(parts(), ["png", "guard", "fi", "svg", "model"]));
  rejected("a div with the \\fi fence before the PNG", join(parts(), ["guard", "fi", "png", "svg", "model"]));
  rejected("a div with a repeated model fence", join({ ...parts(), model: `${parts().model}\n\n${parts().model}` }));
  rejected("a div with a paragraph between its parts", join({ ...parts(), fi: `${parts().fi}\n\nA stray paragraph.` }));
  rejected("a div with an altered guard", block({ ...parts(), guard: parts().guard.replace("\\iftrue", "\\iffalse") }));
  rejected("a div whose \\fi fence says something else", block({ ...parts(), fi: "```{=latex}\n\\relax\n```" }));
  rejected("a div whose model has an unknown version", block(parts(TIKZ, PNG, MODEL.replace('"v":1', '"v":2'))));
  rejected("a div whose model has a dangling point id", block(parts(TIKZ, PNG, MODEL.replace('"b":"p2"', '"b":"p9"'))));
  rejected("a div whose model is not JSON", block(parts(TIKZ, PNG, "{not json")));
  rejected("a drawing div that is empty", `::: {.labshelf-drawing}\n:::\n`);
  rejected("a drawing div over the 256 KB cap", block(parts(TIKZ, "A".repeat(270_000))));
  rejected("a drawing div that never closes", block().replace(/:::\n$/, ""));
  rejected("a drawing div with a CRLF body missing its guard", withEol(join(without("guard")), "\r\n"));

  it("A1 reads a block just under the cap as a drawing", () => {
    const body = block(parts(TIKZ, "A".repeat(200_000)));
    expect(body.length).toBeLessThan(262_144);
    expect(types(bodyToDoc(body))).toEqual(["drawing"]);
    roundTrips(body);
  });

  it("A1 keeps a rejected drawing div raw while the drawing next to it stays a drawing", () => {
    const body = `${join(without("svg"))}\n${block()}`;
    const doc = bodyToDoc(body);
    expect(types(doc)).toEqual(["raw_block", "drawing"]);
    expect(docToBody(doc)).toBe(body);
  });
});

describe("neighbours of drawing blocks", () => {
  it("A1 still reads an output block as an output node and another div as a raw block", () => {
    const body = `::: {.labshelf-output cell="a" source="3f9a1c0b7d2e"}\n$$1$$\n:::\n\n::: {.callout-note}\nA callout.\n:::\n\n${block()}`;
    const doc = bodyToDoc(body);
    expect(types(doc)).toEqual(["output", "raw_block", "drawing"]);
    expect(docToBody(doc)).toBe(body);
  });

  it("A1 does not read a drawing div nested in another div as a drawing", () => {
    const body = `::: {.callout-note}\n${block()}:::\n\n${block()}`;
    const doc = bodyToDoc(body);
    expect(types(doc)).toEqual(["raw_block", "drawing"]);
    expect(docToBody(doc)).toBe(body);
  });
});
