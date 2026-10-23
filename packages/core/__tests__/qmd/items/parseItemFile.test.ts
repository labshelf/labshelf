import { parseItemFile, serializeItemFile, type ItemSegment, type Segment } from "../../../src/qmd/items/index";
import { qmdFixtures, readQmdFixture } from "../fixtures/qmdFixtures";

const items = (segments: readonly Segment[]) => segments.filter((s): s is ItemSegment => s.kind === "item");
const loose = (segments: readonly Segment[]) => segments.flatMap((s) => (s.kind === "loose" ? [s.text] : []));

describe("parseItemFile", () => {
  it.each(qmdFixtures().map((fixture) => [fixture.name, fixture.text]))("round-trips %s byte for byte", (_name, text) => {
    expect(serializeItemFile(parseItemFile(text))).toBe(text);
  });

  it("round-trips the empty file", () => {
    expect(parseItemFile("")).toEqual({ segments: [] });
    expect(serializeItemFile(parseItemFile(""))).toBe("");
  });

  it("reads ids, anchors, authors and dates from the fence", () => {
    const [first, second] = items(parseItemFile(readQmdFixture("notes-math.qmd")).segments);
    expect(first).toMatchObject({
      id: "n-01JB2Q8Z5K7M3V9X4C6T8R2W0Y",
      anchor: { kind: "highlight", annotationId: "3f1c2a9e-8b7d-4c1e-9a2b-5d6e7f809a1b" },
      author: "Ana",
      created: "2026-10-22T09:12:00.000Z",
    });
    expect(first!.body.startsWith("## Attention\n")).toBe(true);
    expect(first!.body.endsWith("$$ {#eq-attention}\n")).toBe(true);
    expect(second!.anchor).toEqual({ kind: "box", page: 10, x: 0.12, y: 0.4, w: 0.3, h: 0.1 });
  });

  it("keeps text outside items, a non-item div and an id-less fence as loose text", () => {
    const file = parseItemFile(readQmdFixture("loose-text.qmd"));
    expect(items(file.segments).map((item) => item.id)).toEqual(["n-01JB2QD0000000000000000000", "n-01JB2QF0000000000000000000"]);
    const outside = loose(file.segments).join("");
    expect(outside).toContain("Loose text a user typed before any item.");
    expect(outside).toContain("An item inside a callout is not at the top level.");
    expect(outside).toContain("A labshelf-item fence without an id.");
    expect(outside).toContain("Trailing loose text.");
  });

  it("keeps unknown classes and attributes in order, and unknown anchors verbatim", () => {
    const [first, second] = items(parseItemFile(readQmdFixture("unknown-attrs.qmd")).segments);
    expect(first!.classes).toEqual(["labshelf-item", "pinned"]);
    expect(first!.attrs.map(([key]) => key)).toEqual(["anchor", "author", "created", "color", "x-future"]);
    expect(first!.author).toBe("Ana \"the reviewer\" Lima");
    expect(first!.attrs.at(-2)).toEqual(["color", "yellow"]);
    expect(first!.anchor).toEqual({ kind: "quote", quote: "a strong baseline", prefix: "We compare against ", suffix: " on three datasets" });
    expect(second).toMatchObject({ id: "hand-written", anchor: { kind: "unknown", raw: "somewhere new" } });
  });

  it("does not end an item at a line of colons inside a code fence", () => {
    const file = parseItemFile(readQmdFixture("code-fence-colons.qmd"));
    const [item] = items(file.segments);
    expect(item!.body).toContain('s = """\n:::\n"""\n```\n');
    expect(loose(file.segments)).toEqual(["\nAbove, a line of colons inside a cell does not close the item.\n"]);
  });

  it("keeps an output block nested inside its item", () => {
    const [item] = items(parseItemFile(readQmdFixture("cell-output.qmd")).segments);
    expect(item!.body).toContain('::: {.labshelf-output cell="bound"');
    expect(item!.close).toBe(":::\n");
  });

  it("never loses text around a malformed fence and still reads the items after it", () => {
    const text = readQmdFixture("unclosed-fence.qmd");
    const file = parseItemFile(text);
    expect(items(file.segments).map((item) => item.id)).toEqual(["n-01JB2QK0000000000000000000"]);
    expect(loose(file.segments).join("")).toContain("This item lost its closing line.");
    expect(loose(file.segments).join("")).toContain("A bad attribute block.");
    expect(serializeItemFile(file)).toBe(text);
  });

  it("treats a whole unclosed item as loose text", () => {
    const text = "::: {#n-01JB2QJ0000000000000000000 .labshelf-item}\nNo closing line.\n";
    expect(parseItemFile(text).segments).toEqual([{ kind: "loose", text }]);
  });

  it("keeps a byte order mark as loose text and still reads the first item", () => {
    const text = `\uFEFF${readQmdFixture("task-list.qmd")}`;
    const file = parseItemFile(text);
    expect(file.segments[0]).toEqual({ kind: "loose", text: "\uFEFF" });
    expect(items(file.segments)).toHaveLength(1);
    expect(serializeItemFile(file)).toBe(text);
  });

  it("reads only \\\" \\\\ and \\' as escapes, and single-quoted values", () => {
    const [item] = items(parseItemFile("::: {#x .labshelf-item path=\"C:\\Users \\\"q\\\"\" author='Ana'}\n:::\n").segments);
    expect(item!.attrs).toEqual([["path", "C:\\Users \"q\""], ["author", "Ana"]]);
  });

  it("does not open a div right after paragraph text, as in Pandoc", () => {
    const text = "::: {#x .labshelf-item}\nLook:\n::: {.callout-note}\ninside\n:::\nafter\n:::\n";
    const [item] = items(parseItemFile(text).segments);
    expect(item!.body).toBe("Look:\n::: {.callout-note}\ninside\n");
  });

  it("opens an item right after a heading", () => {
    expect(items(parseItemFile("# Notes\n::: {#x .labshelf-item}\na\n:::\n").segments)).toHaveLength(1);
  });

  it("does not take a code fence with more than one word after it for a fence, as in Pandoc", () => {
    const text = "::: {#x .labshelf-item}\n```python title\n:::\n\n```\n";
    const [item] = items(parseItemFile(text).segments);
    expect(item!.body).toBe("```python title\n");
  });

  it("keeps CRLF and CR line endings inside the segments", () => {
    const [item] = items(parseItemFile(readQmdFixture("task-list.qmd").replace(/\n/g, "\r\n")).segments);
    expect(item!.fence.endsWith("}\r\n")).toBe(true);
    expect(item!.close).toBe(":::\r\n");
    const [crItem] = items(parseItemFile(readQmdFixture("task-list.qmd").replace(/\n/g, "\r")).segments);
    expect(crItem!.close).toBe(":::\r");
  });

  it("reads a final closing line without a line ending", () => {
    const [item] = items(parseItemFile(readQmdFixture("task-list.qmd").replace(/\n$/, "")).segments);
    expect(item!.close).toBe(":::");
  });
});
