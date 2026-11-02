// Tests the notes editor's item edits: a page's save or create becomes one WorkspaceEdit replacing only that item's bytes of the TextDocument.
import * as vscode from "vscode";
import { itemMessageEdit } from "../../../src/writing/notesEditor/provider";

const ID_A = "n-01JABCDEFGHJKMNPQRSTVWXYZ0";
const ID_B = "n-01JABCDEFGHJKMNPQRSTVWXYZ1";
const TEXT = `intro\n\n::: {#${ID_A} .labshelf-item}\nAlpha\n:::\n\nkept loose\n\n::: {#${ID_B} .labshelf-item}\nBeta\n:::\n`;

/** A TextDocument over `text` whose positions carry the offset they were made from. */
function documentOf(text: string) {
  return { uri: vscode.Uri.file("/lib/papers/x/notes.qmd"), getText: () => text, positionAt: (offset: number) => ({ offset }) as unknown as vscode.Position };
}

interface Replacement { range: { start: { offset: number }; end: { offset: number } }; text: string }
const replacementsOf = (edit: vscode.WorkspaceEdit | undefined): Replacement[] => (edit as unknown as { replacements: Replacement[] } | undefined)?.replacements ?? [];
const applied = (text: string, edit: vscode.WorkspaceEdit | undefined): string =>
  replacementsOf(edit).reduce((acc, r) => acc.slice(0, r.range.start.offset) + r.text + acc.slice(r.range.end.offset), text);

describe("itemMessageEdit", () => {
  it("replaces only the saved item's body and keeps the loose text and the other item byte for byte", () => {
    const edit = itemMessageEdit(documentOf(TEXT), { type: "save", itemId: ID_B, body: "Beta, edited" });
    const [replacement] = replacementsOf(edit);
    expect(replacementsOf(edit)).toHaveLength(1);
    expect(replacement!.range.start.offset).toBeGreaterThan(TEXT.indexOf("kept loose"));
    expect(applied(TEXT, edit)).toBe(TEXT.replace("Beta\n", "Beta, edited\n"));
  });

  it("makes no edit when the body is unchanged", () => {
    expect(itemMessageEdit(documentOf(TEXT), { type: "save", itemId: ID_A, body: "Alpha\n" })).toBeUndefined();
  });

  it("appends a created item stamped with the time, after everything else", () => {
    const edit = itemMessageEdit(documentOf(TEXT), { type: "create", itemId: "n-01JABCDEFGHJKMNPQRSTVWXYZ2", body: "Gamma" }, () => "2026-11-01T00:00:00Z");
    const next = applied(TEXT, edit);
    expect(next.startsWith(TEXT)).toBe(true);
    expect(next).toContain('created="2026-11-01T00:00:00Z"');
    expect(next).toContain("Gamma\n:::");
  });

  it("throws for a body the item writer rejects", () => {
    expect(() => itemMessageEdit(documentOf(TEXT), { type: "save", itemId: ID_A, body: ":::\n" })).toThrow();
  });
});
