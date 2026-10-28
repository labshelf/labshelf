import { deriveTextSha256Hex } from "../../../src/hash/index";
import {
  deriveOriginHash,
  deriveOriginState,
  formatOriginComment,
  parseOriginComment,
  scanOrigins,
  type ManuscriptOrigin,
} from "../../../src/writing/noteLinks/index";

const HASH = "0123456789ab";
const PROJECT_ORIGIN = { notePath: "notes/physics.qmd", label: "eq-energy", hash: HASH };
const PAPER_ORIGIN = { notePath: "paper:smith2020/notes.qmd", label: "fig-curve", hash: "abcdef012345" };

const LATEX_MANUSCRIPT = [
  "\\section{Energy}",
  "Some prose.",
  "\\begin{equation}",
  "E = mc^2",
  "\\label{eq-energy}",
  "\\end{equation} % labshelf: notes/physics.qmd#eq-energy @0123456789ab",
  "",
  "More prose.",
  "\\begin{equation}",
  "y = f(x)",
  "\\label{fig-curve}",
  "\\end{equation} % labshelf: paper:smith2020/notes.qmd#fig-curve @abcdef012345",
  "",
].join("\n");

const TYPST_MANUSCRIPT = [
  "= Energy",
  "Some prose.",
  "$ E = m c^2 $ <eq-energy> // labshelf: notes/physics.qmd#eq-energy @0123456789ab",
  "",
  "More prose.",
  "$ y = f(x) $ <fig-curve> // labshelf: paper:smith2020/notes.qmd#fig-curve @abcdef012345",
  "",
].join("\n");

function originOf(label: string, hash = HASH): ManuscriptOrigin {
  return {
    line: 5,
    notePath: "notes/physics.qmd",
    label,
    hash,
    insertedRange: { start: { line: 2, character: 0 }, end: { line: 5, character: 15 } },
  };
}

describe("13.1a formatOriginComment", () => {
  it("13.1a formats a LaTeX comment with a percent marker", () => {
    expect(formatOriginComment("latex", PROJECT_ORIGIN)).toBe("% labshelf: notes/physics.qmd#eq-energy @0123456789ab");
  });

  it("13.1a formats a Typst comment with a double-slash marker", () => {
    expect(formatOriginComment("typst", PROJECT_ORIGIN)).toBe("// labshelf: notes/physics.qmd#eq-energy @0123456789ab");
  });

  it("13.1a keeps the paper:<id>/notes.qmd path form in the comment", () => {
    expect(formatOriginComment("latex", PAPER_ORIGIN)).toBe("% labshelf: paper:smith2020/notes.qmd#fig-curve @abcdef012345");
  });
});

describe("13.1a parseOriginComment", () => {
  it("13.1a parses a bare LaTeX comment", () => {
    expect(parseOriginComment("% labshelf: notes/physics.qmd#eq-energy @0123456789ab")).toEqual(PROJECT_ORIGIN);
  });

  it("13.1a parses a comment that trails an \\end{equation}", () => {
    expect(parseOriginComment("\\end{equation} % labshelf: notes/physics.qmd#eq-energy @0123456789ab")).toEqual(PROJECT_ORIGIN);
  });

  it("13.1a parses a comment that trails a Typst label", () => {
    expect(parseOriginComment("$ E = m c^2 $ <eq-energy> // labshelf: notes/physics.qmd#eq-energy @0123456789ab")).toEqual(PROJECT_ORIGIN);
  });

  it("13.1a parses a paper note path", () => {
    expect(parseOriginComment("% labshelf: paper:smith2020/notes.qmd#fig-curve @abcdef012345")).toEqual(PAPER_ORIGIN);
  });

  it("13.1a round-trips LaTeX for a project note and a paper note", () => {
    for (const origin of [PROJECT_ORIGIN, PAPER_ORIGIN]) {
      expect(parseOriginComment(formatOriginComment("latex", origin))).toEqual(origin);
    }
  });

  it("13.1a round-trips Typst for a project note and a paper note", () => {
    for (const origin of [PROJECT_ORIGIN, PAPER_ORIGIN]) {
      expect(parseOriginComment(formatOriginComment("typst", origin))).toEqual(origin);
    }
  });
});

describe("13.1a deriveOriginHash", () => {
  it("13.1a is the first 12 hex chars of the SHA-256 of the LaTeX", async () => {
    const latex = "E = mc^2";
    const expected = (await deriveTextSha256Hex(latex)).slice(0, 12);
    const hash = await deriveOriginHash(latex);
    expect(hash).toMatch(/^[0-9a-f]{12}$/);
    expect(hash).toBe(expected);
  });

  it("13.1a differs when the LaTeX differs", async () => {
    expect(await deriveOriginHash("a+b")).not.toBe(await deriveOriginHash("a-b"));
  });

  it("13.1a produces a hash that survives a format and parse round-trip", async () => {
    const hash = await deriveOriginHash("\\int_0^1 x\\,dx");
    expect(parseOriginComment(formatOriginComment("latex", { notePath: "notes/a.qmd", label: "eq-a", hash }))?.hash).toBe(hash);
  });
});

describe("13.1a scanOrigins", () => {
  it("13.1a finds every origin comment in a LaTeX manuscript, in order", () => {
    const origins = scanOrigins("latex", LATEX_MANUSCRIPT);
    expect(origins.map(({ notePath, label, hash }) => ({ notePath, label, hash }))).toEqual([PROJECT_ORIGIN, PAPER_ORIGIN]);
  });

  it("13.1a finds every origin comment in a Typst manuscript, in order", () => {
    const origins = scanOrigins("typst", TYPST_MANUSCRIPT);
    expect(origins.map(({ notePath, label, hash }) => ({ notePath, label, hash }))).toEqual([PROJECT_ORIGIN, PAPER_ORIGIN]);
  });

  it("13.1a gives each origin its own line, increasing down the file", () => {
    for (const [language, text] of [
      ["latex", LATEX_MANUSCRIPT],
      ["typst", TYPST_MANUSCRIPT],
    ] as const) {
      const [first, second] = scanOrigins(language, text);
      expect(second.line).toBeGreaterThan(first.line);
    }
  });

  it("13.1a gives each origin an inserted range that contains its line", () => {
    for (const origin of scanOrigins("latex", LATEX_MANUSCRIPT)) {
      expect(origin.insertedRange.start.line).toBeLessThanOrEqual(origin.line);
      expect(origin.insertedRange.end.line).toBeGreaterThanOrEqual(origin.line);
    }
  });

  it("13.1a spans the whole equation block in the LaTeX range", () => {
    const [first] = scanOrigins("latex", LATEX_MANUSCRIPT);
    expect(first.insertedRange.end.line - first.insertedRange.start.line).toBeGreaterThanOrEqual(3);
  });

  it("13.1a returns nothing for a manuscript without origin comments", () => {
    expect(scanOrigins("latex", "\\section{A}\n% just a comment\nText.\n")).toEqual([]);
    expect(scanOrigins("typst", "= A\n// just a comment\nText.\n")).toEqual([]);
  });
});

describe("13.1b deriveOriginState", () => {
  it("13.1b is fresh when manuscript and note both still match the origin hash", () => {
    expect(deriveOriginState(originOf("eq-energy"), HASH, { hash: HASH })).toBe("fresh");
  });

  it("13.1b is stale when only the note changed", () => {
    expect(deriveOriginState(originOf("eq-energy"), HASH, { hash: "ffffffffffff" })).toBe("stale");
  });

  it("13.1b is diverged when only the manuscript changed", () => {
    expect(deriveOriginState(originOf("eq-energy"), "eeeeeeeeeeee", { hash: HASH })).toBe("diverged");
  });

  it("13.1b is both when manuscript and note changed", () => {
    expect(deriveOriginState(originOf("eq-energy"), "eeeeeeeeeeee", { hash: "ffffffffffff" })).toBe("both");
  });

  it("13.1b is both when manuscript and note changed to the same new text", () => {
    expect(deriveOriginState(originOf("eq-energy"), "ffffffffffff", { hash: "ffffffffffff" })).toBe("both");
  });
});

describe("13.1b states computed from a scanned manuscript", () => {
  it("13.1b computes the state of each scanned origin against fresh hashes", async () => {
    const latex = "E = mc^2";
    const hash = await deriveOriginHash(latex);
    const text = `\\begin{equation}\n${latex}\n\\label{eq-energy}\n\\end{equation} ${formatOriginComment("latex", { notePath: "notes/physics.qmd", label: "eq-energy", hash })}\n`;
    const [origin] = scanOrigins("latex", text);
    expect(origin.hash).toBe(hash);
    expect(deriveOriginState(origin, await deriveOriginHash(latex), { hash })).toBe("fresh");
    expect(deriveOriginState(origin, await deriveOriginHash("E = m c^2 + 1"), { hash })).toBe("diverged");
    expect(deriveOriginState(origin, await deriveOriginHash(latex), { hash: await deriveOriginHash("E = 0") })).toBe("stale");
  });
});

describe("13.1c missing", () => {
  it("13.1c is missing when the note has no such label", () => {
    expect(deriveOriginState(originOf("eq-gone"), HASH, undefined)).toBe("missing");
  });

  it("13.1c is missing even when the manuscript has changed", () => {
    expect(deriveOriginState(originOf("eq-gone"), "eeeeeeeeeeee", undefined)).toBe("missing");
  });
});

describe("13.1d malformed comments", () => {
  const malformed = [
    "% labshelf: notes/physics.qmd#eq-energy",
    "% labshelf: notes/physics.qmd#eq-energy @",
    "% labshelf: notes/physics.qmd#eq-energy @xyz",
    "% labshelf: notes/physics.qmd#eq-energy @0123456789",
    "% labshelf: notes/physics.qmd @0123456789ab",
    "% labshelf: #eq-energy @0123456789ab",
    "% labshelf: notes/physics.qmd# @0123456789ab",
    "% labshelf:",
    "% labshelf",
    "% just a comment",
    "",
  ];

  it("13.1d parseOriginComment returns undefined for malformed comments", () => {
    for (const line of malformed) {
      expect(parseOriginComment(line)).toBeUndefined();
    }
  });

  it("13.1d parseOriginComment does not throw on malformed comments", () => {
    for (const line of malformed) {
      expect(() => parseOriginComment(line)).not.toThrow();
    }
  });

  it("13.1d scanOrigins skips malformed comments and keeps the valid ones", () => {
    const text = [
      "\\begin{equation}",
      "a = b",
      "\\label{eq-a}",
      "\\end{equation} % labshelf: notes/a.qmd#eq-a @nothex",
      "\\begin{equation}",
      "c = d",
      "\\label{eq-c}",
      "\\end{equation} % labshelf: notes/c.qmd#eq-c @0123456789ab",
      "% labshelf: broken",
      "",
    ].join("\n");
    let origins: ManuscriptOrigin[] = [];
    expect(() => {
      origins = scanOrigins("latex", text);
    }).not.toThrow();
    expect(origins.map((origin) => origin.label)).toEqual(["eq-c"]);
  });

  it("13.1d scanOrigins skips malformed Typst comments", () => {
    const text = ["$ a $ <eq-a> // labshelf: notes/a.qmd#eq-a", "$ c $ <eq-c> // labshelf: notes/c.qmd#eq-c @0123456789ab", ""].join("\n");
    expect(scanOrigins("typst", text).map((origin) => origin.label)).toEqual(["eq-c"]);
  });
});
