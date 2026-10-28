import { buildInsert, buildUpdate, listNoteInsertables, type NoteInsertable, type NoteInsertSource } from "../../../src/writing/noteLinks/noteInsertables";
import { deriveCodeHash } from "../../../src/qmd/cellOutput";
import { deriveOriginHash, formatOriginComment, parseOriginComment } from "../../../src/writing/noteLinks/originComment";
import { scanOrigins } from "../../../src/writing/noteLinks/scanOrigins";
import type { ManuscriptOrigin } from "../../../src/writing/noteLinks/scanOrigins";
import type { OriginState } from "../../../src/writing/noteLinks/originState";

const CELL_CODE = "#| label: result\nx = 1\nprint(x)";

function itemBlock(id: string, body: string): string {
  return `::: {#n-${id} .labshelf-item}\n${body}\n:::\n`;
}

function outputBlock(cell: string, source: string, content: string): string {
  return `::: {.labshelf-output cell="${cell}" source="${source}" engine="python-3.12" ran="2026-10-22T09:15:03.000Z"}\n${content}\n:::\n`;
}

function sourceFor(notes: Record<string, string>, papers: Record<string, string>): NoteInsertSource {
  return {
    listProjectNotes: async () => Object.keys(notes).map((path) => ({ path, title: path === "notes/energy.qmd" ? "Energy" : "Other" })),
    readProjectNote: async (path) => notes[path],
    listCitedPaperIds: async () => Object.keys(papers),
    readPaperNote: async (paperId) => papers[paperId],
  };
}

async function projectNoteText(source: string): Promise<string> {
  const body = [
    "Mass and energy.",
    "",
    "$$ E = mc^2 $$ {#eq-energy}",
    "",
    "```{python}",
    CELL_CODE,
    "```",
    "",
    outputBlock("result", source, "$$\n\\sqrt{\\pi}\n$$"),
  ].join("\n");
  return itemBlock("01JB2Q8Z5K7M3V9X4C6T8R2W0Y", body);
}

const PAPER_NOTE = itemBlock("01JB2Q8Z5K7M3V9X4C6T8R2W1Z", "$$\n\\int_0^1 x\\,dx\n$$ {#eq-int}");

const ITEM: NoteInsertable = {
  notePath: "notes/energy.qmd",
  label: "eq-energy",
  latex: "E = mc^2",
  source: "equation",
  title: "Energy",
};

function originFor(item: NoteInsertable, hash: string): ManuscriptOrigin {
  return {
    line: 4,
    notePath: item.notePath,
    label: item.label,
    hash,
    insertedRange: { start: { line: 2, character: 0 }, end: { line: 4, character: 20 } },
  };
}

describe("noteInsertables", () => {
  describe("13.2a listing", () => {
    it("13.2a lists the project note's equation and output, then the cited paper's equation, in order", async () => {
      const source = sourceFor(
        { "notes/energy.qmd": await projectNoteText(await deriveCodeHash(CELL_CODE)) },
        { "paper-1": PAPER_NOTE },
      );
      const items = await listNoteInsertables(source);
      expect(items.map((item) => [item.notePath, item.label, item.source])).toEqual([
        ["notes/energy.qmd", "eq-energy", "equation"],
        ["notes/energy.qmd", "result", "output"],
        ["paper:paper-1/notes.qmd", "eq-int", "equation"],
      ]);
    });

    it("13.2a gives the trimmed latex of the equation and of the output's display block", async () => {
      const source = sourceFor(
        { "notes/energy.qmd": await projectNoteText(await deriveCodeHash(CELL_CODE)) },
        { "paper-1": PAPER_NOTE },
      );
      const items = await listNoteInsertables(source);
      expect(items.map((item) => item.latex)).toEqual(["E = mc^2", "\\sqrt{\\pi}", "\\int_0^1 x\\,dx"]);
    });

    it("13.2a gives project items the title of their note", async () => {
      const source = sourceFor({ "notes/energy.qmd": await projectNoteText(await deriveCodeHash(CELL_CODE)) }, {});
      const items = await listNoteInsertables(source);
      expect(items.map((item) => item.title)).toEqual(["Energy", "Energy"]);
    });

    it("13.2a leaves out the outOfDate field on up-to-date items", async () => {
      const source = sourceFor(
        { "notes/energy.qmd": await projectNoteText(await deriveCodeHash(CELL_CODE)) },
        { "paper-1": PAPER_NOTE },
      );
      for (const item of await listNoteInsertables(source)) {
        expect(item.outOfDate).toBeUndefined();
        expect("outOfDate" in item).toBe(false);
      }
    });

    it("13.2a lists project notes in listProjectNotes order and papers in listCitedPaperIds order", async () => {
      const second = itemBlock("01JB2Q8Z5K7M3V9X4C6T8R2W2A", "$$ a = b $$ {#eq-second}");
      const source: NoteInsertSource = {
        listProjectNotes: async () => [{ path: "notes/z.qmd", title: "Z" }, { path: "notes/a.qmd", title: "A" }],
        readProjectNote: async (path) => (path === "notes/z.qmd" ? itemBlock("01JB2Q8Z5K7M3V9X4C6T8R2W3B", "$$ z = 1 $$ {#eq-z}") : second),
        listCitedPaperIds: async () => ["p2", "p1"],
        readPaperNote: async (id) => itemBlock(`01JB2Q8Z5K7M3V9X4C6T8R2W4${id === "p1" ? "C" : "D"}`, `$$ ${id} = 1 $$ {#eq-${id}}`),
      };
      const items = await listNoteInsertables(source);
      expect(items.map((item) => item.notePath)).toEqual(["notes/z.qmd", "notes/a.qmd", "paper:p2/notes.qmd", "paper:p1/notes.qmd"]);
    });

    it("13.2a skips a paper without a note and an output without a display block", async () => {
      const plain = itemBlock("01JB2Q8Z5K7M3V9X4C6T8R2W5E", ["```{python}", CELL_CODE, "```", "", outputBlock("result", await deriveCodeHash(CELL_CODE), "42")].join("\n"));
      const source = sourceFor({ "notes/energy.qmd": plain }, { "paper-1": undefined as unknown as string });
      expect(await listNoteInsertables(source)).toEqual([]);
    });

    it("13.2a lists an equation of a paper note with source equation and a string title", async () => {
      const [item] = await listNoteInsertables(sourceFor({}, { "paper-1": PAPER_NOTE }));
      expect(item).toMatchObject({ notePath: "paper:paper-1/notes.qmd", label: "eq-int", latex: "\\int_0^1 x\\,dx", source: "equation" });
      expect(typeof item!.title).toBe("string");
    });
  });

  describe("13.2d out-of-date outputs", () => {
    it("13.2d lists an output whose source differs from its cell's code hash with outOfDate true", async () => {
      const source = sourceFor({ "notes/energy.qmd": await projectNoteText("000000000000") }, {});
      const items = await listNoteInsertables(source);
      const output = items.find((item) => item.source === "output");
      expect(output).toMatchObject({ label: "result", notePath: "notes/energy.qmd", outOfDate: true });
    });

    it("13.2d does not mark the equation next to an out-of-date output", async () => {
      const source = sourceFor({ "notes/energy.qmd": await projectNoteText("000000000000") }, {});
      const equation = (await listNoteInsertables(source)).find((item) => item.source === "equation");
      expect(equation?.outOfDate).toBeUndefined();
    });

    it("13.2d buildInsert rejects with an Error for an out-of-date output", async () => {
      const source = sourceFor({ "notes/energy.qmd": await projectNoteText("000000000000") }, {});
      const output = (await listNoteInsertables(source)).find((item) => item.source === "output")!;
      await expect(buildInsert(output, "latex")).rejects.toBeInstanceOf(Error);
    });

    it("13.2d buildInsert still builds the insert for the same output once its source matches the code", async () => {
      const source = sourceFor({ "notes/energy.qmd": await projectNoteText(await deriveCodeHash(CELL_CODE)) }, {});
      const output = (await listNoteInsertables(source)).find((item) => item.source === "output")!;
      await expect(buildInsert(output, "latex")).resolves.toContain("\\label{result}");
    });

    it("13.2d an output changes from out of date to current when only #| option lines of the cell differ", async () => {
      const hash = await deriveCodeHash("x = 1\nprint(x)");
      const source = sourceFor({ "notes/energy.qmd": await projectNoteText(hash) }, {});
      const output = (await listNoteInsertables(source)).find((item) => item.source === "output")!;
      expect(output.outOfDate).toBeUndefined();
    });
  });

  describe("13.2b insert text", () => {
    it("13.2b LaTeX insert text carries the origin comment", async () => {
      const text = await buildInsert(ITEM, "latex");
      const hash = await deriveOriginHash(ITEM.latex);
      const comment = formatOriginComment("latex", { notePath: ITEM.notePath, label: ITEM.label, hash });
      expect(text).toContain(comment);
    });

    it("13.2b Typst insert rejects with an Error that names the conversion", async () => {
      await expect(buildInsert(ITEM, "typst")).rejects.toThrow(/typst/i);
    });

    it("13.2b LaTeX insert text wraps the equation with its label in an equation environment", async () => {
      const text = await buildInsert(ITEM, "latex");
      expect(text).toContain("\\begin{equation}");
      expect(text).toContain("E = mc^2");
      expect(text).toContain("\\label{eq-energy}");
      expect(text).toContain("\\end{equation}");
    });

    it("13.2b the origin comment sits on the end-of-equation line", async () => {
      const text = await buildInsert(ITEM, "latex");
      const endLine = text.split("\n").find((line) => line.includes("\\end{equation}"));
      expect(endLine).toBeDefined();
      expect(endLine).toContain("% labshelf: notes/energy.qmd#eq-energy @");
    });

    it("13.2b the comment of the insert parses back to the note path, label and hash of the latex", async () => {
      const text = await buildInsert(ITEM, "latex");
      const parsed = text.split("\n").map((line) => parseOriginComment(line)).find((found) => found !== undefined);
      expect(parsed).toEqual({ notePath: ITEM.notePath, label: ITEM.label, hash: await deriveOriginHash(ITEM.latex) });
    });

    it("13.2b the insert text is found by scanOrigins when placed in a manuscript", async () => {
      const text = await buildInsert(ITEM, "latex");
      const origins = scanOrigins("latex", `\\section{A}\n\n${text}\n\nafter\n`);
      expect(origins).toHaveLength(1);
      expect(origins[0]).toMatchObject({ notePath: ITEM.notePath, label: ITEM.label, hash: await deriveOriginHash(ITEM.latex) });
    });
  });

  describe("13.2c update", () => {
    it("13.2c update does nothing on a fresh or missing origin", async () => {
      const origin = originFor(ITEM, await deriveOriginHash("E = mc^2"));
      expect(await buildUpdate(origin, "fresh", ITEM)).toBeUndefined();
      expect(await buildUpdate(origin, "missing", ITEM)).toBeUndefined();
    });

    it("13.2c update is refused on a diverged origin", async () => {
      const origin = originFor(ITEM, await deriveOriginHash("E = mc^2"));
      expect(await buildUpdate(origin, "diverged", ITEM)).toBeUndefined();
    });

    it("13.2c update is refused on an origin where both changed", async () => {
      const origin = originFor(ITEM, await deriveOriginHash("E = mc^2"));
      expect(await buildUpdate(origin, "both", ITEM)).toBeUndefined();
    });

    it("13.2c update of a stale origin replaces exactly the inserted range with the note's latex", async () => {
      const changed: NoteInsertable = { ...ITEM, latex: "E = \\gamma m c^2" };
      const origin = originFor(changed, await deriveOriginHash("E = mc^2"));
      const update = await buildUpdate(origin, "stale" satisfies OriginState, changed);
      expect(update).toBeDefined();
      expect(update!.range).toEqual(origin.insertedRange);
      expect(update!.text).toContain("E = \\gamma m c^2");
    });
  });
});
