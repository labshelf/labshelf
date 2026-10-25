// Converts core's TextMate insert snippets into CodeMirror templates without altering their literal text.
import { imageSnippet, tableSnippet } from "@labshelf/core";
import { codeMirrorTemplate } from "../../../src/writing/source/codeMirrorTemplate";

describe("codeMirrorTemplate", () => {
  it("unescapes a backslash and a dollar sign", () => {
    expect(codeMirrorTemplate("a\\\\b")).toBe("a\\b");
    expect(codeMirrorTemplate("cost \\$5")).toBe("cost $5");
  });

  it("turns the final cursor and bare tab stops into CodeMirror fields", () => {
    expect(codeMirrorTemplate("x$0")).toBe("x${0}");
    expect(codeMirrorTemplate("$1 and $2")).toBe("${1} and ${2}");
  });

  it("keeps a placeholder field", () => {
    expect(codeMirrorTemplate("${1:Caption}")).toBe("${1:Caption}");
  });

  it("doubles a literal backslash that sits before a brace, which CodeMirror would read as an escape", () => {
    expect(codeMirrorTemplate("\\\\{x}")).toBe("\\\\{x}");
    expect(codeMirrorTemplate("\\}")).toBe("}");
  });

  it("converts a LaTeX image figure", () => {
    const converted = codeMirrorTemplate(imageSnippet("latex", "images/a.png"));
    expect(converted).toContain("\\begin{figure}[h]");
    expect(converted).toContain("\\includegraphics[width=0.8\\linewidth]{images/a.png}");
    expect(converted).toContain("\\caption{${1:Caption}}");
    expect(converted.endsWith("${0}")).toBe(true);
  });

  it("converts a Typst table, keeping the cell stops", () => {
    const converted = codeMirrorTemplate(tableSnippet("typst", { columns: 2, rows: 1 }));
    expect(converted).toContain("columns: 2,");
    expect(converted).toContain("[${1}], [${2}],");
    expect(converted).toContain("caption: [${3:Caption}],");
    expect(converted.endsWith("${0}")).toBe(true);
  });
});
