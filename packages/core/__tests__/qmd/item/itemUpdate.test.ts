
import { addItem, removeItem, setItemBody, isItemId, createItemIdGenerator, newItemId } from "../../../src/qmd/item/itemUpdate";
import { parseItemFile, serializeItemFile } from "../../../src/qmd/item/itemFile";
import { readQmdFixture } from "../fixtures/qmdFixtures";

const ID_A = "n-01JB2QN0000000000000000000";
const ID_B = "n-01JB2QP0000000000000000000";

describe("itemEdit", () => {
  it("adds an item to an empty file with the canonical attribute order", () => {
    const file = addItem(parseItemFile(""), {
      id: ID_A,
      anchor: { kind: "box", page: 3, x: 0.1, y: 0.2, w: 0.3, h: 0.4 },
      author: "Ana \"A\"",
      created: "2026-10-22T09:12:00.000Z",
      body: "Hello $x$",
    });
    expect(serializeItemFile(file)).toBe(
      `::: {#${ID_A} .labshelf-item anchor="p3 box 0.1 0.2 0.3 0.4" author="Ana \\"A\\"" created="2026-10-22T09:12:00.000Z"}\nHello $x$\n:::\n`,
    );
    expect(parseItemFile(serializeItemFile(file))).toEqual(file);
  });

  it("appends after one empty line, keeping every existing byte", () => {
    const text = readQmdFixture("notes-math.qmd");
    const out = serializeItemFile(addItem(parseItemFile(text), { id: ID_A, body: "Added.\n" }));
    expect(out).toBe(`${text}\n::: {#${ID_A} .labshelf-item}\nAdded.\n:::\n`);
  });

  it("ends a file without a final newline before appending, and uses the file's line ending", () => {
    const text = readQmdFixture("task-list.qmd").replace(/\n/g, "\r\n").replace(/\r\n$/, "");
    const out = serializeItemFile(addItem(parseItemFile(text), { id: ID_A, body: "one\ntwo" }));
    expect(out).toBe(`${text}\r\n\r\n::: {#${ID_A} .labshelf-item}\r\none\r\ntwo\r\n:::\r\n`);
  });

  it("rejects an invalid or taken id", () => {
    const file = addItem(parseItemFile(""), { id: ID_A, body: "" });
    expect(() => addItem(file, { id: ID_A, body: "" })).toThrow(/already exists/);
    expect(() => addItem(file, { id: "hand-written", body: "" })).toThrow(/ULID/);
  });

  it.each([
    ["a closing line", "text\n:::\nmore"],
    ["an unclosed div", "::: {.callout-note}\ntext"],
    ["an unclosed code fence", "```{python}\nx = 1"],
  ])("rejects a body with %s", (_case, body) => {
    expect(() => addItem(parseItemFile(""), { id: ID_A, body })).toThrow(new RegExp(ID_A));
  });

  it("accepts a body with a balanced nested div and colons inside code", () => {
    const body = "```{python}\n#| label: c\ns = \"\"\"\n:::\n\"\"\"\n```\n\n::: {.labshelf-output cell=\"c\" source=\"0123456789ab\"}\nout\n:::\n";
    const file = addItem(parseItemFile(""), { id: ID_A, body });
    expect(parseItemFile(serializeItemFile(file))).toEqual(file);
  });

  it("rejects an edit whose code fence would pair with an unclosed fence elsewhere in the file", () => {
    const text = "Intro\n```\nnot closed\n\n::: {#B .labshelf-item}\nold\n:::\n";
    const file = parseItemFile(text);
    expect(() => addItem(file, { id: ID_A, body: "```\ncode\n```\n" })).toThrow(/other parts of the file/);
    expect(() => setItemBody(file, "B", "```py\nx\n```")).toThrow(/other parts of the file/);
  });

  it("rejects a body whose div opens right after paragraph text, which Quarto reads as text", () => {
    expect(() => addItem(parseItemFile(""), { id: ID_A, body: "Look:\n::: {.callout-note}\nx\n:::\n" })).toThrow(/div/);
  });

  it("leaves out empty attribute values and adds no second empty line after a blank last line", () => {
    const out = serializeItemFile(addItem(parseItemFile("para\n   \n"), { id: ID_A, author: "", created: "", body: "a" }));
    expect(out).toBe(`para\n   \n::: {#${ID_A} .labshelf-item}\na\n:::\n`);
  });

  it("replaces one item's body and leaves every other byte alone", () => {
    const text = readQmdFixture("loose-text.qmd");
    const out = serializeItemFile(setItemBody(parseItemFile(text), "n-01JB2QD0000000000000000000", "Edited."));
    expect(out).toBe(text.replace("First.\n", "Edited.\n"));
  });

  it("refuses to edit an id that is missing or repeated", () => {
    const twice = `::: {#x .labshelf-item}\na\n:::\n::: {#x .labshelf-item}\nb\n:::\n`;
    expect(() => setItemBody(parseItemFile(twice), "x", "c")).toThrow(/found 2/);
    expect(() => removeItem(parseItemFile(twice), "y")).toThrow(/found 0/);
  });

  it("removes an item with its separating empty line and keeps loose text", () => {
    const start = addItem(addItem(parseItemFile("Intro\n"), { id: ID_A, body: "a" }), { id: ID_B, body: "b" });
    expect(serializeItemFile(removeItem(start, ID_B))).toBe(`Intro\n\n::: {#${ID_A} .labshelf-item}\na\n:::\n`);
    expect(serializeItemFile(removeItem(start, ID_A))).toBe(`Intro\n\n::: {#${ID_B} .labshelf-item}\nb\n:::\n`);
    const text = readQmdFixture("loose-text.qmd");
    const out = serializeItemFile(removeItem(parseItemFile(text), "n-01JB2QF0000000000000000000"));
    expect(out).toContain("Trailing loose text.");
    expect(out).not.toContain("Second.");
  });
});

const zeros = (bytes: Uint8Array<ArrayBuffer>) => bytes.fill(0);
const ones = (bytes: Uint8Array<ArrayBuffer>) => bytes.fill(0xff);

describe("itemId", () => {
  it("writes n- plus a ULID whose time part encodes the clock", () => {
    const id = createItemIdGenerator(() => 1469918176385, zeros)();
    expect(id).toBe("n-01ARYZ6S410000000000000000");
    expect(isItemId(id)).toBe(true);
  });

  it("creates valid ids by default", () => {
    expect(isItemId(newItemId())).toBe(true);
  });

  it("increases within one millisecond and sorts by time", () => {
    let time = 1_700_000_000_000;
    const next = createItemIdGenerator(() => time, (bytes) => bytes.fill(0x7f));
    const sameMs = [next(), next(), next()];
    time += 1;
    const later = next();
    expect([...sameMs, later]).toEqual([...sameMs, later].sort());
    expect(new Set([...sameMs, later]).size).toBe(4);
    expect(sameMs[1]!.slice(0, 12)).toBe(sameMs[0]!.slice(0, 12));
  });

  it("carries into higher digits and fails on overflow", () => {
    const next = createItemIdGenerator(() => 5, ones);
    expect(next().endsWith("ZZZZZZZZZZZZZZZZ")).toBe(true);
    expect(() => next()).toThrow(/overflowed/);
    const carry = createItemIdGenerator(() => 5, (bytes) => { bytes.fill(0); bytes[9] = 0x1f; return bytes; });
    expect(carry().slice(-2)).toBe("0Z");
    expect(carry().slice(-2)).toBe("10");
  });

  it("rejects clocks outside 48 bits", () => {
    expect(() => createItemIdGenerator(() => -1, zeros)()).toThrow(/clock/);
    expect(() => createItemIdGenerator(() => 2 ** 48, zeros)()).toThrow(/clock/);
  });

  it("recognises only n- plus a ULID", () => {
    expect(isItemId("n-01ARYZ6S41TSV4RRFFQ69G5FAV")).toBe(true);
    expect(isItemId("01ARYZ6S41TSV4RRFFQ69G5FAV")).toBe(false);
    expect(isItemId("n-01ARYZ6S41TSV4RRFFQ69G5FA")).toBe(false);
    expect(isItemId("n-01ARYZ6S41TSV4RRFFQ69G5FAI")).toBe(false);
    expect(isItemId("n-81ARYZ6S41TSV4RRFFQ69G5FAV")).toBe(false);
  });
});
