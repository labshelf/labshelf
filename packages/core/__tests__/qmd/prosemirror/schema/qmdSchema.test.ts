import { qmdSchema as s } from "../../../../src/qmd/prosemirror/schema/index";

const p = (...content: Parameters<typeof s.text>[0][]) => s.node("paragraph", null, content.map((text) => s.text(text)));

describe("qmdSchema", () => {
  it("holds a document with every node and mark", () => {
    const em = s.mark("em", { marker: "_" });
    const inline = s.node("paragraph", null, [
      s.text("plain "),
      s.text("emphasis", [em]),
      s.text("strong", [s.mark("strong")]),
      s.text("code", [s.mark("code", { ticks: 2 })]),
      s.text("paper", [s.mark("link", { href: "labshelf:vaswani2017#p4" })]),
      s.node("hard_break", { marker: "  " }),
      s.node("math_inline", { tex: "x^2" }),
      s.node("image", { src: "figures/model.png", alt: "The model" }),
      s.node("citation", { keys: ["a", "b"], raw: "[@a; @b]" }),
    ]);
    const doc = s.node("doc", { eol: "\r\n", trailing: "\r\n", unterminated: true }, [
      s.node("heading", { level: 2, space: " " }, [s.text("Title")]),
      inline,
      s.node("bullet_list", { marker: "*" }, [
        s.node("list_item", { prefix: "* " }, [p("one"), s.node("ordered_list", { order: 3, delimiter: ")" }, [s.node("list_item", null, [p("three")])])]),
        s.node("task_item", { checked: true, mark: "X" }, [p("done")]),
      ]),
      s.node("math_display", { tex: "E = mc^2", label: "eq-energy", gap: "\n" }),
      s.node("code_cell", { lang: "python", options: "#| label: bound\n", code: "print(1)\n", fence: "````", info: "{python}" }),
      s.node("output", { cell: "bound", source: "3f9a1c0b7d2e", engine: "python-3.12", ran: "2026-10-22T09:15:03.000Z", raw: "::: {.labshelf-output}\n1\n:::\n" }),
      s.node("raw_block", { text: "> quote\n" }),
    ]);
    expect(() => doc.check()).not.toThrow();
  });

  it("rejects attributes of the wrong type", () => {
    expect(() => s.node("citation", { keys: [1] })).toThrow(RangeError);
  });
});
