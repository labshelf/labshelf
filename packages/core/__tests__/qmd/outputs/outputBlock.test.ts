import { parseItemFile, type ItemSegment } from "../../../src/qmd/items/index";
import { cellSourceHash, findOutputs, formatOutput } from "../../../src/qmd/outputs/index";
import { readQmdFixture } from "../fixtures/qmdFixtures";

describe("outputBlock", () => {
  it("finds the output block of a cell with its attributes and offsets", () => {
    const item = parseItemFile(readQmdFixture("cell-output.qmd")).segments[0] as ItemSegment;
    const [output] = findOutputs(item.body);
    expect(output).toMatchObject({
      cell: "bound",
      source: "3f9a1c0b7d2e",
      engine: "python-3.12 sympy-1.13",
      ran: "2026-10-22T09:15:03.000Z",
      content: "$$\\sqrt{\\pi}$$\n",
    });
    expect(item.body.slice(output!.start, output!.end)).toBe(
      '::: {.labshelf-output cell="bound" source="3f9a1c0b7d2e" engine="python-3.12 sympy-1.13" ran="2026-10-22T09:15:03.000Z"}\n$$\\sqrt{\\pi}$$\n:::\n',
    );
  });

  it("ignores a block without cell or source and one inside a code fence", () => {
    const body = "::: {.labshelf-output cell=\"a\"}\nx\n:::\n```\n::: {.labshelf-output cell=\"b\" source=\"0123456789ab\"}\n:::\n```\n";
    expect(findOutputs(body)).toEqual([]);
  });

  it("refuses content that would end the block early", () => {
    expect(() => formatOutput({ cell: "c", source: "0123456789ab", engine: "python-3.12", ran: "r", content: "a\n:::\nb" })).toThrow(/cell c/);
  });

  it("writes a block that it reads back", () => {
    const block = formatOutput({ cell: "c", source: "0123456789ab", engine: "python-3.12", ran: "2026-10-22T09:15:03.000Z", content: "a\r\nb" }, "\r\n");
    expect(block).toBe('::: {.labshelf-output cell="c" source="0123456789ab" engine="python-3.12" ran="2026-10-22T09:15:03.000Z"}\r\na\r\nb\r\n:::\r\n');
    expect(findOutputs(block)).toEqual([
      { cell: "c", source: "0123456789ab", engine: "python-3.12", ran: "2026-10-22T09:15:03.000Z", content: "a\r\nb\r\n", start: 0, end: block.length },
    ]);
  });
});

describe("cellSourceHash", () => {
  it("is the first 12 hex characters of the SHA-256 of the code without option lines", async () => {
    expect(await cellSourceHash("x = 1")).toBe("8ff436def145");
    expect(await cellSourceHash("#| label: a\nx = 1\n\n")).toBe("8ff436def145");
  });

  it("does not depend on line endings but does on the code", async () => {
    expect(await cellSourceHash("a = 1\r\nb = 2\r\n")).toBe(await cellSourceHash("a = 1\nb = 2"));
    expect(await cellSourceHash("a = 1\nb = 3")).not.toBe(await cellSourceHash("a = 1\nb = 2"));
  });
});
