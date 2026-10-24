import type { Node } from "prosemirror-model";
import { qmdSchema as s } from "../../../src/qmd/editor/schema/index";
import { docToBody } from "../../../src/qmd/editor/docToBody";
import { serializeBlock } from "../../../src/qmd/editor/serializeBlocks";

const p = (text: string, gap: string | null = null) => s.node("paragraph", { gap }, [s.text(text)]);
const doc = (blocks: Node[], attrs: Record<string, unknown> = {}) => s.node("doc", attrs, blocks);

describe("serializeBlock and docToBody keep source spellings", () => {
  it("writes gaps verbatim", () => {
    expect(docToBody(doc([p("a"), p("b", "\n\n\n"), p("c", "")]))).toBe("a\n\n\n\nb\nc\n");
  });

  it("strips the last line ending when unterminated and appends trailing blank lines", () => {
    expect(docToBody(doc([p("a"), p("b")], { unterminated: true }))).toBe("a\n\nb");
    expect(docToBody(doc([p("a")], { trailing: "\n\n" }))).toBe("a\n\n\n");
    expect(docToBody(doc([s.node("paragraph")], { trailing: "\n\n" }))).toBe("\n\n");
  });

  it("keeps a heading's space and writes bare hashes for an empty heading", () => {
    expect(serializeBlock(s.node("heading", { level: 3, space: "   " }, [s.text("T")]), "\n")).toBe("###   T\n");
    expect(serializeBlock(s.node("heading", { level: 2 }), "\n")).toBe("##\n");
  });

  it("keeps a tilde fence with its info and closing line", () => {
    const cell = s.node("code_cell", { lang: "r", code: "x\n", fence: "~~~~", info: " {r} ", close: "~~~~~  " });
    expect(serializeBlock(cell, "\n")).toBe("~~~~ {r} \nx\n~~~~~  \n");
  });

  it("forces a longer fence and drops info and close when the code would close it", () => {
    const cell = s.node("code_cell", { lang: "r", code: "~~~~~ \n", fence: "~~~", info: " {r}", close: "~~~ " });
    expect(serializeBlock(cell, "\n")).toBe("~~~~~~{r}\n~~~~~ \n~~~~~~\n");
  });

  it("writes ordered items with the list's delimiter and keeps exact prefixes", () => {
    const list = s.node("ordered_list", { order: 3, delimiter: ")" }, [
      s.node("list_item", null, [p("a")]),
      s.node("list_item", { prefix: "4)   " }, [p("b"), p("c")]),
      s.node("list_item", { gap: "\n" }, [p("d")]),
    ]);
    expect(serializeBlock(list, "\n")).toBe("3) a\n4)   b\n\n     c\n\n5) d\n");
  });

  it("keeps a task item's mark, prefix and space", () => {
    const list = s.node("bullet_list", { marker: "*" }, [
      s.node("task_item", { checked: true, mark: "X", prefix: "*  ", space: "  " }, [p("done"), p("more", "")]),
    ]);
    expect(serializeBlock(list, "\n")).toBe("*  [X]  done\n   more\n");
  });

  it("writes raw blocks and outputs verbatim at top level and indented inside an item", () => {
    expect(serializeBlock(s.node("raw_block", { text: "| a |\r\n| - |\n" }), "\r\n")).toBe("| a |\r\n| - |\n");
    expect(serializeBlock(s.node("output", { raw: "::: out\nx\n:::\n" }), "\n")).toBe("::: out\nx\n:::\n");
    const list = s.node("bullet_list", null, [
      s.node("list_item", null, [p("a"), s.node("raw_block", { text: "| a |\n\n| b |\n" }), s.node("output", { raw: "::: o\n:::\n" })]),
    ]);
    expect(serializeBlock(list, "\n")).toBe("- a\n\n  | a |\n\n  | b |\n\n  ::: o\n  :::\n");
  });

  it("converts line endings to CRLF except inside a top-level raw block", () => {
    const body = docToBody(doc([
      s.node("heading", { level: 1 }, [s.text("T")]),
      s.node("raw_block", { text: "<div>\n</div>\n" }),
      s.node("bullet_list", null, [s.node("list_item", null, [p("a"), p("b")])]),
    ], { eol: "\r\n" }));
    expect(body).toBe("# T\r\n\r\n<div>\n</div>\n\r\n- a\r\n\r\n  b\r\n");
  });
});
