/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions": ["node", "node-addons"]}
 */
// Build problems become editor diagnostics on their line, clamped to the document, with the hint in the message.
import { EditorState } from "@codemirror/state";
import { toDiagnostics } from "../../../src/library-page/editor/problemDiagnostics";

const view = { state: EditorState.create({ doc: "one\ntwo\nthree" }) };

describe("toDiagnostics", () => {
  it("covers the problem's one-based line", () => {
    expect(toDiagnostics([{ severity: "error", message: "Boom", file: "main.tex", line: 2 }], view))
      .toEqual([{ from: 4, to: 7, severity: "error", message: "Boom" }]);
  });

  it("puts a problem without a line on line 1 and clamps a line past the end", () => {
    const result = toDiagnostics([
      { severity: "warning", message: "No line", file: "main.tex" },
      { severity: "info", message: "Far", file: "main.tex", line: 99 },
    ], view);
    expect(result.map((d) => [d.from, d.to, d.severity])).toEqual([[0, 3, "warning"], [8, 13, "info"]]);
  });

  it("appends the hint after the message", () => {
    const [diagnostic] = toDiagnostics([{ severity: "error", message: "Undefined", hint: "Check the spelling", file: "main.tex", line: 1 }], view);
    expect(diagnostic?.message).toBe("Undefined\nCheck the spelling");
  });
});
