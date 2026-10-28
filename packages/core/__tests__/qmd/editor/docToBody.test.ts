import { qmdSchema as s } from "../../../src/qmd/editor/qmdSchema";
import { docToBody } from "../../../src/qmd/editor/qmdDoc";

const p = (text: string) => s.node("paragraph", null, [s.text(text)]);

describe("docToBody", () => {
  it("writes an editor-built document canonically", () => {
    const doc = s.node("doc", null, [
      s.node("heading", { level: 2 }, [s.text("Title")]),
      s.node("paragraph", null, [
        s.text("plain "),
        s.text("em", [s.mark("em")]),
        s.text(" "),
        s.text("strong", [s.mark("strong")]),
        s.node("hard_break"),
        s.text("code", [s.mark("code")]),
        s.text(" "),
        s.node("citation", { keys: ["a", "b"] }),
      ]),
      s.node("bullet_list", null, [
        s.node("list_item", null, [p("one"), s.node("ordered_list", null, [s.node("list_item", null, [p("a")]), s.node("list_item", null, [p("b")])])]),
        s.node("task_item", { checked: true }, [p("done")]),
        s.node("task_item", null, [p("open")]),
      ]),
      s.node("math_display", { tex: "E = mc^2", label: "eq-energy" }),
      s.node("code_cell", { lang: "python", options: "#| label: a\n", code: "print(1)\n" }),
    ]);
    expect(docToBody(doc)).toBe([
      "## Title",
      "",
      "plain *em* **strong**\\",
      "`code` [@a; @b]",
      "",
      "- one",
      "  1. a",
      "  2. b",
      "- [x] done",
      "- [ ] open",
      "",
      "$$E = mc^2$$ {#eq-energy}",
      "",
      "```{python}",
      "#| label: a",
      "print(1)",
      "```",
      "",
    ].join("\n"));
  });

  it("writes an empty document as an empty body", () => {
    expect(docToBody(s.node("doc", null, [s.node("paragraph")]))).toBe("");
  });

  it("writes a longer fence when the code contains a closing fence", () => {
    const doc = s.node("doc", null, [s.node("code_cell", { lang: "python", code: "```\n" })]);
    expect(docToBody(doc)).toBe("````{python}\n```\n````\n");
  });

  it("writes the document's line ending", () => {
    const doc = s.node("doc", { eol: "\r\n" }, [p("a"), p("b")]);
    expect(docToBody(doc)).toBe("a\r\n\r\nb\r\n");
  });
});
