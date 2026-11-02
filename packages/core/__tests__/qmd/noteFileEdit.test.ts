// Tests the notes-file edit mapping: an item edit or a new item as the smallest text replacement of the file.
import { diffNoteFileText, noteItemAddEdit, noteItemBodyEdit, parseItemFile, type NoteFileReplacement } from "../../src/qmd/index";

const NEW_ID = "n-01JABCDEFGHJKMNPQRSTVWXYZ0";

const apply = (text: string, edit: NoteFileReplacement | undefined): string => (edit ? text.slice(0, edit.start) + edit.insert + text.slice(edit.end) : text);

const FILE = [
  "---\ntitle: Notes\n---\n\n",
  "::: {#a1 .labshelf-item created=\"2026-01-01\"}\nFirst body\n:::\n",
  "\nloose words\n\n",
  "::: {#b2 .labshelf-item}\nSecond body\n:::\n",
].join("");

describe("noteItemBodyEdit", () => {
  it("replaces only inside the edited item, keeping loose text and other items byte for byte", () => {
    const edit = noteItemBodyEdit(FILE, "b2", "Second body, edited\n");
    const next = apply(FILE, edit);
    expect(next).toBe(FILE.replace("Second body\n", "Second body, edited\n"));
    const itemStart = FILE.indexOf("Second body");
    expect(edit!.start).toBeGreaterThanOrEqual(itemStart);
    expect(edit!.end).toBeLessThanOrEqual(FILE.indexOf(":::", itemStart));
  });

  it("writes the file's line ending and a final line break", () => {
    const crlf = FILE.replace(/\n/g, "\r\n");
    const next = apply(crlf, noteItemBodyEdit(crlf, "a1", "line one\nline two"));
    expect(next).toBe(crlf.replace("First body\r\n", "line one\r\nline two\r\n"));
  });

  it("is undefined when the body is already stored", () => {
    expect(noteItemBodyEdit(FILE, "a1", "First body\n")).toBeUndefined();
  });

  it("throws for an unknown id or a body that would close the item early", () => {
    expect(() => noteItemBodyEdit(FILE, "zz", "x")).toThrow();
    expect(() => noteItemBodyEdit(FILE, "a1", ":::\nescaped\n")).toThrow();
  });
});

describe("noteItemAddEdit", () => {
  it("appends a new item after the existing text without changing it", () => {
    const next = apply(FILE, noteItemAddEdit(FILE, { id: NEW_ID, body: "New", created: "2026-02-02" }));
    expect(next.startsWith(FILE)).toBe(true);
    const items = parseItemFile(next).segments.flatMap((s) => (s.kind === "item" ? [s] : []));
    expect(items.map((item) => item.id)).toEqual(["a1", "b2", NEW_ID]);
    expect(items[2]).toMatchObject({ body: "New\n", created: "2026-02-02" });
  });

  it("creates the first item of an empty file", () => {
    const next = apply("", noteItemAddEdit("", { id: NEW_ID, body: "Hello", created: "2026-02-02" }));
    expect(parseItemFile(next).segments).toHaveLength(1);
  });
});

describe("diffNoteFileText", () => {
  it("covers only the changed span", () => {
    expect(diffNoteFileText("abcXdef", "abcYYdef")).toEqual({ start: 3, end: 4, insert: "YY" });
    expect(diffNoteFileText("same", "same")).toBeUndefined();
    expect(diffNoteFileText("aa", "aaa")).toEqual({ start: 2, end: 2, insert: "a" });
  });
});
