import { mergeItemFiles } from "../../../src/qmd/merge/index";
import { addItem, parseItemFile, removeItem, replaceItemBody, serializeItemFile } from "../../../src/qmd/items/index";
import { formatOutput } from "../../../src/qmd/outputs/index";
import { mergeText } from "../../../src/writing/merge/node/mergeText";

const A = "n-01JB2QN0000000000000000000";
const B = "n-01JB2QP0000000000000000000";
const C = "n-01JB2QQ0000000000000000000";
const D = "n-01JB2QR0000000000000000000";

const item = (id: string, body: string, attrs = "") => `::: {#${id} .labshelf-item${attrs}}\n${body}:::\n`;
const BASE = `${item(A, "First.\n")}\n${item(B, "Second.\n")}`;

function merge(local: string, other: string, base: string | null = BASE) {
  return mergeItemFiles({ ...(base === null ? {} : { base }), local, other, otherLabel: "Syncthing" }, mergeText);
}
const add = (text: string, id: string, body: string) => serializeItemFile(addItem(parseItemFile(text), { id, body }));
const remove = (text: string, id: string) => serializeItemFile(removeItem(parseItemFile(text), id));
const edit = (text: string, id: string, body: string) => serializeItemFile(replaceItemBody(parseItemFile(text), id, body));
const ids = (text: string) => parseItemFile(text).segments.flatMap((s) => (s.kind === "item" ? [s.id] : []));

describe("mergeItemFiles", () => {
  it("keeps both items when each side appended one, without conflict markers (A2)", () => {
    const local = add(BASE, D, "Local note.\n");
    const other = add(BASE, C, "Other note.\n");
    const result = merge(local, other);
    expect(result.conflicted).toBe(false);
    expect(result.text).toBe(`${BASE}\n${item(C, "Other note.\n")}\n${item(D, "Local note.\n")}`);
    expect(merge(other, local).text).toBe(result.text);
  });

  it("honours a delete when the other side left the item untouched (A2)", () => {
    expect(merge(remove(BASE, A), BASE).text).toBe(item(B, "Second.\n"));
    expect(merge(BASE, remove(BASE, B)).text).toBe(item(A, "First.\n"));
  });

  it("keeps an item deleted on one side and edited on the other, edited (A2)", () => {
    const result = merge(remove(BASE, A), edit(BASE, A, "First, edited.\n"));
    expect(ids(result.text)).toEqual([A, B]);
    expect(result.text).toContain("First, edited.");
    expect(merge(edit(BASE, A, "Mine.\n"), remove(BASE, A)).text).toContain("Mine.");
  });

  it("drops an item both sides deleted and keeps one-sided edits", () => {
    expect(merge(remove(BASE, A), remove(BASE, A)).text).toBe(item(B, "Second.\n"));
    const result = merge(edit(BASE, A, "A2\n"), edit(BASE, B, "B2\n"));
    expect(result).toEqual({ text: `${item(A, "A2\n")}\n${item(B, "B2\n")}`, conflicted: false });
  });

  it("merges both-sided edits of one item line by line, with markers only inside the item", () => {
    const base = item(A, "one\ntwo\nthree\n");
    const clean = mergeItemFiles({ base, local: item(A, "ONE\ntwo\nthree\n"), other: item(A, "one\ntwo\nTHREE\n"), otherLabel: "x" }, mergeText);
    expect(clean).toEqual({ text: item(A, "ONE\ntwo\nTHREE\n"), conflicted: false });
    const marked = mergeItemFiles({ base, local: item(A, "one\nmine\nthree\n"), other: item(A, "one\ntheirs\nthree\n"), otherLabel: "Dropbox" }, mergeText);
    expect(marked.conflicted).toBe(true);
    expect(marked.text).toBe(item(A, "one\n<<<<<<< local\nmine\n=======\ntheirs\n>>>>>>> Dropbox\nthree\n"));
  });

  it("keeps both versions as items when a line merge would break the item's fences", () => {
    const base = item(A, "text\n");
    const local = item(A, "```{python}\nx = 1\n```\n");
    const other = item(A, "::: {.note}\nhi\n:::\n");
    const result = mergeItemFiles({ base, local, other, otherLabel: "x" }, mergeText);
    expect(result.conflicted).toBe(true);
    expect(parseItemFile(result.text).segments.filter((s) => s.kind === "item")).toHaveLength(2);
    expect(result.text).toContain("x = 1");
    expect(result.text).toContain("hi");
  });

  it("merges attributes one by one when both sides changed the opening line", () => {
    const base = item(A, "x\n", ' anchor="hl:1"');
    const local = item(A, "x\n", ' anchor="hl:2"');
    const other = item(A, "x\n", ' anchor="hl:1" resolved="true"');
    expect(merge(local, other, base).text).toBe(item(A, "x\n", ' anchor="hl:2" resolved="true"'));
  });

  it("keeps the result of the later run when both sides re-ran a cell", () => {
    const cell = "```{python}\n#| label: c\n1+1\n```\n\n";
    const out = (content: string, ran: string) => formatOutput({ cell: "c", source: "aaaaaaaaaaaa", engine: "python-3.12", ran, content });
    const base = item(A, `${cell}${out("old\n", "2026-01-01T00:00:00.000Z")}`);
    const early = item(A, `${cell}${out("early\n", "2026-01-02T00:00:00.000Z")}`);
    const late = item(A, `${cell}${out("late\n", "2026-01-03T00:00:00.000Z")}`);
    expect(merge(early, late, base)).toEqual({ text: late, conflicted: false });
    expect(merge(late, early, base)).toEqual({ text: late, conflicted: false });
  });

  it("orders items both sides added at the same place by id and keeps each side's run together", () => {
    const early = "n-01JB2QP0000000000000000001";
    const local = add(add(BASE, early, "l1\n"), D, "l2\n");
    const other = add(BASE, C, "o1\n");
    expect(ids(merge(local, other).text)).toEqual([A, B, early, D, C]);
    expect(ids(merge(other, local).text)).toEqual([A, B, early, D, C]);
  });

  it("keeps an added item after its preceding base item", () => {
    const local = `${item(A, "First.\n")}\n${item(C, "Inserted.\n")}\n${item(B, "Second.\n")}`;
    const other = edit(BASE, B, "Second, edited.\n");
    expect(merge(local, other).text).toBe(`${item(A, "First.\n")}\n${item(C, "Inserted.\n")}\n${item(B, "Second, edited.\n")}`);
  });

  it("merges loose text between the same items as text and never drops it", () => {
    const base = `---\ntitle: x\n---\n\n${BASE}`;
    const local = base.replace("title: x", "title: y");
    const other = `${base}\nA line typed by hand.\n`;
    expect(merge(local, other, base).text).toBe(`---\ntitle: y\n---\n\n${BASE}\nA line typed by hand.\n`);
  });

  it("without a base, unions items by id and marks differing bodies inside the item", () => {
    const local = add(item(A, "same\n"), B, "mine\n");
    const other = add(item(A, "same\n"), B, "theirs\n");
    const result = merge(local, other, null);
    expect(result.conflicted).toBe(true);
    expect(ids(result.text)).toEqual([A, B]);
    expect(result.text).toContain("<<<<<<< local\nmine\n=======\ntheirs\n>>>>>>> Syncthing\n");
    expect(merge(item(A, "x\n"), item(C, "y\n"), null).text).toBe(`${item(A, "x\n")}\n${item(C, "y\n")}`);
  });

  it("returns local byte for byte when the other side is unchanged, line endings included", () => {
    const crlf = add(BASE, C, "x\n").replace(/\n/g, "\r\n");
    expect(merge(crlf, BASE.replace(/\n/g, "\r\n"), BASE.replace(/\n/g, "\r\n")).text).toBe(crlf);
  });

  it("adds a line ending to an item that was last without one when the other side appended", () => {
    const base = BASE.replace(/\n$/, "");
    const local = edit(base, A, "First, edited.\n");
    const other = add(base, C, "Appended.\n");
    expect(merge(local, other, base).text).toBe(`${item(A, "First, edited.\n")}\n${item(B, "Second.\n")}\n${item(C, "Appended.\n")}`);
  });
});

describe("mergeItemFiles with a base a side never held", () => {
  it("ignores a base that shares no item with one side, so no item is deleted", () => {
    const result = mergeItemFiles({ base: item(A, "x\n"), local: item(A, "x\n"), other: item(C, "y\n"), otherLabel: "x" }, mergeText);
    expect(result.text).toBe(`${item(A, "x\n")}\n${item(C, "y\n")}`);
  });
});
