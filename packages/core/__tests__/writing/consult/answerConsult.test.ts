/** Verifies the consult port's service: what each list kind offers, paper PDF and marks, browse, open, and that io failures become error replies. */
import type { Annotation, PaperRecord } from "../../../src/model/index";
import type { ReadyProject } from "../../../src/writing/project/index";
import { formatError } from "../../../src/errors/index";
import { answerConsult, type ConsultIo } from "../../../src/writing/consult/answerConsult";
import type { ConsultContext, ConsultEntry, ConsultRef, ConsultReply, ConsultRequest } from "../../../src/writing/consult/consultRequests";

function paper(id: string, title: string, extra: Partial<PaperRecord> = {}): PaperRecord {
  return { id, title, path: `papers/${id}`, citeKey: "", status: "unread", ...extra } as PaperRecord;
}

function project(id: string, title?: string): ReadyProject {
  return { kind: "ready", folder: `/p/${id}`, location: "library", settings: { id, format: "latex", engine: "pdflatex", ...(title ? { title } : {}) } as ReadyProject["settings"], main: undefined };
}

interface Setup {
  papers?: PaperRecord[];
  projects?: ReadyProject[];
  files?: Record<string, string[]>;
  notes?: Record<string, string[]>;
  withNotes?: string[];
  code?: string[];
  marks?: Record<string, Annotation[]>;
  notesText?: Record<string, string | null>;
}

function makeIo(s: Setup = {}, over: Partial<ConsultIo> = {}): ConsultIo {
  return {
    listPapers: async () => s.papers ?? [],
    paperPdfBase64: async (p) => `pdf:${p.id}`,
    annotationsOf: async (id) => s.marks?.[id] ?? [],
    paperNotesText: async (id) => s.notesText?.[id] ?? null,
    paperIdsWithNotes: async () => s.withNotes ?? [],
    projects: async () => s.projects ?? [],
    listFiles: async (p) => s.files?.[p.settings.id] ?? [],
    listCodeFiles: async () => s.code ?? [],
    ...(s.notes ? { projectNotes: async (p: ReadyProject) => s.notes?.[p.settings.id] ?? [] } : {}),
    ...over,
  };
}

async function ask(io: ConsultIo, request: ConsultRequest, context: ConsultContext = {}): Promise<ConsultReply> {
  return answerConsult(io, context, request);
}

async function entriesOf(io: ConsultIo, what: "paper" | "notes" | "manuscript" | "code", context: ConsultContext = {}): Promise<ConsultEntry[]> {
  const reply = await ask(io, { kind: "list", what }, context);
  if (!reply.ok || reply.value.kind !== "entries") { throw new Error(`not an entries reply: ${JSON.stringify(reply)}`); }
  return reply.value.entries;
}

describe("answerConsult list paper", () => {
  it("7.1a lists every paper sorted by title with label = title", async () => {
    const io = makeIo({ papers: [paper("b", "Beta"), paper("a", "alpha"), paper("c", "Gamma")] });
    const entries = await entriesOf(io, "paper");
    const expected = ["alpha", "Beta", "Gamma"];
    expect(entries.map((e) => e.label)).toEqual(expected);
    expect(entries.map((e) => e.ref)).toEqual([{ kind: "paper", paperId: "a" }, { kind: "paper", paperId: "b" }, { kind: "paper", paperId: "c" }]);
  });

  it("7.1a gives the detail '@citeKey · year' with the parts that are present", async () => {
    const io = makeIo({ papers: [
      paper("a", "A", { citeKey: "smith2020", year: 2020 }),
      paper("b", "B", { citeKey: "lee1999" }),
      paper("c", "C"),
    ] });
    const entries = await entriesOf(io, "paper");
    expect(entries[0]!.detail).toBe("@smith2020 · 2020");
    expect(entries[1]!.detail).toBe("@lee1999");
    expect(entries[2]!.detail).toBeUndefined();
  });

  it("7.1a reports canBrowse false for paper, notes and manuscript lists even when io.browse exists", async () => {
    const io = makeIo({}, { browse: async () => null });
    for (const what of ["paper", "notes", "manuscript"] as const) {
      const reply = await ask(io, { kind: "list", what });
      expect(reply).toMatchObject({ ok: true, value: { kind: "entries", canBrowse: false } });
    }
  });
});

describe("answerConsult list notes", () => {
  it("7.1a lists papers with notes as paperNotes entries in group Papers, sorted by title", async () => {
    const io = makeIo({ papers: [paper("a", "Zeta"), paper("b", "Alpha"), paper("c", "Mid")], withNotes: ["a", "b"] });
    const entries = await entriesOf(io, "notes");
    expect(entries).toEqual([
      { ref: { kind: "paperNotes", paperId: "b" }, label: "Alpha", group: "Papers" },
      { ref: { kind: "paperNotes", paperId: "a" }, label: "Zeta", group: "Papers" },
    ]);
  });

  it("7.1a follows the paper notes with the notes of the context project, labelled by path and grouped by project title", async () => {
    const io = makeIo({
      papers: [paper("a", "Alpha")], withNotes: ["a"],
      projects: [project("p1", "First"), project("p2", "Second")],
      notes: { p1: ["notes/a.qmd", "notes/b.qmd"], p2: ["other.qmd"] },
    });
    const entries = await entriesOf(io, "notes", { projectId: "p1" });
    expect(entries).toEqual([
      { ref: { kind: "paperNotes", paperId: "a" }, label: "Alpha", group: "Papers" },
      { ref: { kind: "projectNote", projectId: "p1", path: "notes/a.qmd" }, label: "notes/a.qmd", group: "First" },
      { ref: { kind: "projectNote", projectId: "p1", path: "notes/b.qmd" }, label: "notes/b.qmd", group: "First" },
    ]);
  });

  it("7.1a lists no project notes when the context names no project or an unknown one", async () => {
    const io = makeIo({ projects: [project("p1", "First")], notes: { p1: ["a.qmd"] } });
    expect(await entriesOf(io, "notes", {})).toEqual([]);
    expect(await entriesOf(io, "notes", { projectId: "nope" })).toEqual([]);
  });

  it("7.1a lists no project notes when io.projectNotes is absent", async () => {
    const io = makeIo({ projects: [project("p1", "First")] });
    expect(io.projectNotes).toBeUndefined();
    expect(await entriesOf(io, "notes", { projectId: "p1" })).toEqual([]);
  });
});

describe("answerConsult list manuscript", () => {
  const projects = [project("pb", "Beta"), project("pa", "Alpha"), project("pc", "Gamma")];
  const files = {
    pa: ["b.tex", "a.typ", "img.png", "notes.txt"],
    pb: ["Main.TEX", "refs.bib", "sub/x.md", "q.qmd", "data.csv"],
    pc: ["z.typ"],
  };

  it("7.1a keeps only .tex, .typ, .md, .qmd and .bib files, case-insensitively", async () => {
    const entries = await entriesOf(makeIo({ projects, files }), "manuscript");
    const labels = entries.map((e) => e.label);
    expect(labels).toEqual(expect.arrayContaining(["a.typ", "b.tex", "Main.TEX", "refs.bib", "sub/x.md", "q.qmd", "z.typ"]));
    expect(labels).not.toContain("img.png");
    expect(labels).not.toContain("notes.txt");
    expect(labels).not.toContain("data.csv");
    expect(labels).toHaveLength(7);
  });

  it("7.1a orders projects by title, files alphabetically within one, and gives refs and groups", async () => {
    const entries = await entriesOf(makeIo({ projects, files }), "manuscript");
    expect(entries.map((e) => `${e.group}:${e.label}`)).toEqual([
      "Alpha:a.typ", "Alpha:b.tex",
      "Beta:Main.TEX", "Beta:q.qmd", "Beta:refs.bib", "Beta:sub/x.md",
      "Gamma:z.typ",
    ]);
    expect(entries[0]!.ref).toEqual({ kind: "manuscript", projectId: "pa", path: "a.typ" });
  });

  it("7.1a puts the context project first and the others by title", async () => {
    const entries = await entriesOf(makeIo({ projects, files }), "manuscript", { projectId: "pc" });
    const groups = entries.map((e) => e.group);
    expect(groups[0]).toBe("Gamma");
    expect([...new Set(groups)]).toEqual(["Gamma", "Alpha", "Beta"]);
  });

  it("7.1a groups a project without a title by its id", async () => {
    const entries = await entriesOf(makeIo({ projects: [project("solo")], files: { solo: ["a.tex"] } }), "manuscript");
    expect(entries).toEqual([{ ref: { kind: "manuscript", projectId: "solo", path: "a.tex" }, label: "a.tex", group: "solo" }]);
  });
});

describe("answerConsult list code", () => {
  it("7.1a lists the code files in the order given with the last path segment as label and the full path as detail", async () => {
    const io = makeIo({ code: ["src/z/main.ts", "lib/a.py", "top.js"] });
    expect(await entriesOf(io, "code")).toEqual([
      { ref: { kind: "code", path: "src/z/main.ts" }, label: "main.ts", detail: "src/z/main.ts" },
      { ref: { kind: "code", path: "lib/a.py" }, label: "a.py", detail: "lib/a.py" },
      { ref: { kind: "code", path: "top.js" }, label: "top.js", detail: "top.js" },
    ]);
  });

  it("7.1a reports canBrowse true only when io.browse exists", async () => {
    const withBrowse = await ask(makeIo({}, { browse: async () => null }), { kind: "list", what: "code" });
    const without = await ask(makeIo(), { kind: "list", what: "code" });
    expect(withBrowse).toMatchObject({ ok: true, value: { canBrowse: true } });
    expect(without).toMatchObject({ ok: true, value: { canBrowse: false } });
  });
});

describe("answerConsult paperPdf and paperMarks", () => {
  const annotation = { id: "n1", paperId: "a", type: "highlight", pageNumber: 1, content: "x", createdAt: "t", updatedAt: "t" } as Annotation;

  it("7.1b returns the PDF base64 of a known paper", async () => {
    const io = makeIo({ papers: [paper("a", "A")] });
    expect(await ask(io, { kind: "paperPdf", paperId: "a" })).toEqual({ ok: true, value: { kind: "pdf", base64: "pdf:a" } });
  });

  it("7.1b returns the annotations and notes text of a known paper", async () => {
    const io = makeIo({ papers: [paper("a", "A")], marks: { a: [annotation] }, notesText: { a: "my notes" } });
    expect(await ask(io, { kind: "paperMarks", paperId: "a" })).toEqual({ ok: true, value: { kind: "marks", annotations: [annotation], notesText: "my notes" } });
  });

  it("7.1b returns notesText null when the paper has no notes", async () => {
    const io = makeIo({ papers: [paper("a", "A")] });
    expect(await ask(io, { kind: "paperMarks", paperId: "a" })).toEqual({ ok: true, value: { kind: "marks", annotations: [], notesText: null } });
  });

  it("7.1b answers 'Paper not found' for an unknown paper id in paperPdf and paperMarks", async () => {
    const io = makeIo({ papers: [paper("a", "A")] });
    expect(await ask(io, { kind: "paperPdf", paperId: "zzz" })).toEqual({ ok: false, error: "Paper not found" });
    expect(await ask(io, { kind: "paperMarks", paperId: "zzz" })).toEqual({ ok: false, error: "Paper not found" });
  });
});

describe("answerConsult errors", () => {
  it("7.1b turns a throwing io into ok:false with the formatted error instead of rejecting", async () => {
    const boom = new Error("disk gone");
    const io = makeIo({}, {
      listPapers: async () => { throw boom; },
      projects: async () => { throw boom; },
      listCodeFiles: async () => { throw boom; },
      paperIdsWithNotes: async () => { throw boom; },
    });
    const requests: ConsultRequest[] = [
      { kind: "list", what: "paper" }, { kind: "list", what: "notes" }, { kind: "list", what: "manuscript" }, { kind: "list", what: "code" },
      { kind: "paperPdf", paperId: "a" }, { kind: "paperMarks", paperId: "a" },
    ];
    for (const request of requests) {
      await expect(ask(io, request)).resolves.toEqual({ ok: false, error: formatError(boom) });
    }
  });

  it("7.1b turns a throwing paperPdfBase64, annotationsOf, browse and open into ok:false", async () => {
    const boom = new Error("nope");
    const io = makeIo({ papers: [paper("a", "A")] }, {
      paperPdfBase64: async () => { throw boom; },
      annotationsOf: async () => { throw boom; },
      browse: async () => { throw boom; },
      open: async () => { throw boom; },
    });
    const expected = { ok: false, error: formatError(boom) };
    await expect(ask(io, { kind: "paperPdf", paperId: "a" })).resolves.toEqual(expected);
    await expect(ask(io, { kind: "paperMarks", paperId: "a" })).resolves.toEqual(expected);
    await expect(ask(io, { kind: "browse" })).resolves.toEqual(expected);
    await expect(ask(io, { kind: "open", ref: { kind: "code", path: "a.ts" } })).resolves.toEqual(expected);
  });

  it("7.1b formats a non-Error throw too and still does not reject", async () => {
    const io = makeIo({}, { listPapers: async () => { throw "plain string"; } });
    await expect(ask(io, { kind: "list", what: "paper" })).resolves.toEqual({ ok: false, error: formatError("plain string") });
  });
});

describe("answerConsult browse", () => {
  it("7.1c answers 'Browse is not available' when io.browse is absent", async () => {
    expect(await ask(makeIo(), { kind: "browse" })).toEqual({ ok: false, error: "Browse is not available" });
  });

  it("7.1c answers picked with a null entry when the user picked nothing", async () => {
    const io = makeIo({}, { browse: async () => null });
    expect(await ask(io, { kind: "browse" })).toEqual({ ok: true, value: { kind: "picked", entry: null } });
  });

  it("7.1c turns a picked path into a code entry labelled by name with the path as detail", async () => {
    const io = makeIo({}, { browse: async () => ({ path: "/home/me/x.py", name: "x.py" }) });
    expect(await ask(io, { kind: "browse" })).toEqual({
      ok: true, value: { kind: "picked", entry: { ref: { kind: "code", path: "/home/me/x.py" }, label: "x.py", detail: "/home/me/x.py" } },
    });
  });

  it("7.1c turns a picked id without a path into a pickedFile entry labelled by name", async () => {
    const io = makeIo({}, { browse: async () => ({ id: "h1", name: "data.R" }) });
    expect(await ask(io, { kind: "browse" })).toEqual({
      ok: true, value: { kind: "picked", entry: { ref: { kind: "pickedFile", id: "h1", name: "data.R" }, label: "data.R" } },
    });
  });
});

describe("answerConsult open", () => {
  function openIo(): { io: ConsultIo; opened: ConsultRef[] } {
    const opened: ConsultRef[] = [];
    return { io: makeIo({}, { open: async (ref) => { opened.push(ref); } }), opened };
  }

  it("7.1c answers 'Open is not available' when io.open is absent", async () => {
    expect(await ask(makeIo(), { kind: "open", ref: { kind: "code", path: "a.ts" } })).toEqual({ ok: false, error: "Open is not available" });
  });

  it("7.1c calls io.open with the ref and answers opened", async () => {
    const { io, opened } = openIo();
    const refs: ConsultRef[] = [
      { kind: "paper", paperId: "a" },
      { kind: "paperNotes", paperId: "a" },
      { kind: "projectNote", projectId: "p", path: "n/a.qmd" },
      { kind: "manuscript", projectId: "p", path: "sec/main.tex" },
      { kind: "code", path: "/abs/x.py" },
      { kind: "pickedFile", id: "h", name: "x" },
    ];
    for (const ref of refs) {
      expect(await ask(io, { kind: "open", ref })).toEqual({ ok: true, value: { kind: "opened" } });
    }
    expect(opened).toEqual(refs);
  });

  it("7.1c refuses a manuscript path with a '..' segment without calling io.open", async () => {
    const { io, opened } = openIo();
    for (const path of ["../x.tex", "a/../../x.tex", "a/..", "a/../b.tex"]) {
      expect(await ask(io, { kind: "open", ref: { kind: "manuscript", projectId: "p", path } })).toEqual({ ok: false, error: "Not a manuscript" });
    }
    expect(opened).toEqual([]);
  });

  it("7.1c refuses an absolute manuscript path without calling io.open", async () => {
    const { io, opened } = openIo();
    for (const path of ["/etc/x.tex", "/x.tex"]) {
      expect(await ask(io, { kind: "open", ref: { kind: "manuscript", projectId: "p", path } })).toEqual({ ok: false, error: "Not a manuscript" });
    }
    expect(opened).toEqual([]);
  });

  it("7.1c refuses a manuscript path without a manuscript extension without calling io.open", async () => {
    const { io, opened } = openIo();
    for (const path of ["run.sh", "image.png", "noext", "a.tex.bak"]) {
      expect(await ask(io, { kind: "open", ref: { kind: "manuscript", projectId: "p", path } })).toEqual({ ok: false, error: "Not a manuscript" });
    }
    expect(opened).toEqual([]);
  });

  it("7.1c accepts every manuscript extension, in any case, and a file name that merely contains dots", async () => {
    const { io, opened } = openIo();
    for (const path of ["a.tex", "a.typ", "a.md", "a.qmd", "a.bib", "A.TEX", "dir/sub/b..c.md", "ok..hidden/x.tex"]) {
      expect(await ask(io, { kind: "open", ref: { kind: "manuscript", projectId: "p", path } })).toEqual({ ok: true, value: { kind: "opened" } });
    }
    expect(opened).toHaveLength(8);
  });

  it("7.1c does not apply the manuscript path rule to code refs", async () => {
    const { io, opened } = openIo();
    const ref: ConsultRef = { kind: "code", path: "/abs/run.sh" };
    expect(await ask(io, { kind: "open", ref })).toEqual({ ok: true, value: { kind: "opened" } });
    expect(opened).toEqual([ref]);
  });
});
