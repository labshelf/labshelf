// Tests that a VS Code snippet becomes a CodeMirror template.
import { deriveSnippetTemplate } from "../../../src/latex/catalogCompletion";

describe("deriveSnippetTemplate", () => {
  it("writes VS Code snippets as CodeMirror templates", () => {
    expect(deriveSnippetTemplate("item[$1] $0")).toBe("item[${1}] ${0}");
    expect(deriveSnippetTemplate("left\\{${1:x}")).toBe("left\\\\{${1:x}");
  });
});
