/** Verifies the strict plain-data guards of the consult port: every valid request and reply is accepted, malformed ones are not. */
import { isConsultReply, isConsultRequest } from "../../../src/writing/consult/consultRequests";

const refs: unknown[] = [
  { kind: "paper", paperId: "p1" },
  { kind: "paperNotes", paperId: "p1" },
  { kind: "projectNote", projectId: "pr", path: "n/a.qmd" },
  { kind: "manuscript", projectId: "pr", path: "main.tex" },
  { kind: "code", path: "src/a.ts" },
  { kind: "pickedFile", id: "h1", name: "a.R" },
];

const validRequests: unknown[] = [
  { kind: "list", what: "paper" },
  { kind: "list", what: "notes" },
  { kind: "list", what: "manuscript" },
  { kind: "list", what: "code" },
  { kind: "paperPdf", paperId: "p1" },
  { kind: "paperMarks", paperId: "p1" },
  { kind: "browse" },
  ...refs.map((ref) => ({ kind: "open", ref })),
];

describe("isConsultRequest", () => {
  it.each(validRequests.map((r) => [JSON.stringify(r), r]))("7.1d accepts %s", (_name, request) => {
    expect(isConsultRequest(request)).toBe(true);
  });

  it("7.1d rejects a 'read' request, which does not exist", () => {
    expect(isConsultRequest({ kind: "read", projectId: "p", path: "a.tex" })).toBe(false);
    expect(isConsultRequest({ kind: "read", ref: { kind: "code", path: "a.ts" } })).toBe(false);
  });

  it("7.1d rejects unknown kinds and unknown list kinds", () => {
    expect(isConsultRequest({ kind: "write" })).toBe(false);
    expect(isConsultRequest({ kind: "list", what: "papers" })).toBe(false);
    expect(isConsultRequest({ kind: "list", what: "pdf" })).toBe(false);
    expect(isConsultRequest({ kind: "list" })).toBe(false);
    expect(isConsultRequest({})).toBe(false);
  });

  it("7.1d rejects missing or non-string fields", () => {
    expect(isConsultRequest({ kind: "paperPdf" })).toBe(false);
    expect(isConsultRequest({ kind: "paperPdf", paperId: 4 })).toBe(false);
    expect(isConsultRequest({ kind: "paperMarks", paperId: null })).toBe(false);
    expect(isConsultRequest({ kind: "open" })).toBe(false);
    expect(isConsultRequest({ kind: "open", ref: "code" })).toBe(false);
    expect(isConsultRequest({ kind: "list", what: 1 })).toBe(false);
  });

  it("7.1d rejects an open request whose ref is malformed", () => {
    for (const ref of [
      null, [], {}, { kind: "unknown" },
      { kind: "paper" }, { kind: "paper", paperId: 1 },
      { kind: "paperNotes" },
      { kind: "projectNote", projectId: "p" }, { kind: "projectNote", path: "a.qmd" },
      { kind: "manuscript", projectId: "p" }, { kind: "manuscript", projectId: 1, path: "a.tex" },
      { kind: "code" }, { kind: "code", path: 5 },
      { kind: "pickedFile", id: "h" }, { kind: "pickedFile", name: "x" },
    ]) {
      expect(isConsultRequest({ kind: "open", ref })).toBe(false);
    }
  });

  it("7.1d rejects null, arrays and non-objects", () => {
    for (const value of [null, undefined, [], [{ kind: "browse" }], "browse", 3, true, () => ({ kind: "browse" })]) {
      expect(isConsultRequest(value)).toBe(false);
    }
  });
});

const entry = { ref: { kind: "code", path: "a.ts" }, label: "a.ts" };
const annotation = { id: "n1", paperId: "p", type: "highlight", pageNumber: 1, content: "", createdAt: "t", updatedAt: "t" };

const validReplies: unknown[] = [
  { ok: true, value: { kind: "entries", entries: [], canBrowse: false } },
  { ok: true, value: { kind: "entries", entries: [entry, { ...entry, detail: "src/a.ts", group: "G" }, ...refs.map((ref) => ({ ref, label: "l" }))], canBrowse: true } },
  { ok: true, value: { kind: "pdf", base64: "AAAA" } },
  { ok: true, value: { kind: "pdf", base64: "" } },
  { ok: true, value: { kind: "marks", annotations: [], notesText: null } },
  { ok: true, value: { kind: "marks", annotations: [annotation], notesText: "text" } },
  { ok: true, value: { kind: "picked", entry: null } },
  { ok: true, value: { kind: "picked", entry } },
  { ok: true, value: { kind: "opened" } },
  { ok: false, error: "Paper not found" },
];

describe("isConsultReply", () => {
  it.each(validReplies.map((r) => [JSON.stringify(r).slice(0, 80), r]))("7.1d accepts %s", (_name, reply) => {
    expect(isConsultReply(reply)).toBe(true);
  });

  it("7.1d rejects an error reply whose error is not a string and an ok flag that is not boolean", () => {
    expect(isConsultReply({ ok: false })).toBe(false);
    expect(isConsultReply({ ok: false, error: 3 })).toBe(false);
    expect(isConsultReply({ ok: "true", value: { kind: "opened" } })).toBe(false);
    expect(isConsultReply({ value: { kind: "opened" } })).toBe(false);
  });

  it("7.1d rejects an ok reply with a missing or unknown value", () => {
    expect(isConsultReply({ ok: true })).toBe(false);
    expect(isConsultReply({ ok: true, value: null })).toBe(false);
    expect(isConsultReply({ ok: true, value: [] })).toBe(false);
    expect(isConsultReply({ ok: true, value: { kind: "text", text: "x" } })).toBe(false);
    expect(isConsultReply({ ok: true, value: { kind: "read", text: "x", version: "v" } })).toBe(false);
  });

  it("7.1d rejects entries replies with bad fields", () => {
    expect(isConsultReply({ ok: true, value: { kind: "entries", entries: [] } })).toBe(false);
    expect(isConsultReply({ ok: true, value: { kind: "entries", entries: [], canBrowse: "no" } })).toBe(false);
    expect(isConsultReply({ ok: true, value: { kind: "entries", entries: "x", canBrowse: false } })).toBe(false);
    expect(isConsultReply({ ok: true, value: { kind: "entries", entries: [{ label: "x" }], canBrowse: false } })).toBe(false);
    expect(isConsultReply({ ok: true, value: { kind: "entries", entries: [{ ref: { kind: "code", path: "a" } }], canBrowse: false } })).toBe(false);
    expect(isConsultReply({ ok: true, value: { kind: "entries", entries: [{ ref: { kind: "code" }, label: "x" }], canBrowse: false } })).toBe(false);
    expect(isConsultReply({ ok: true, value: { kind: "entries", entries: [{ ref: { kind: "nope" }, label: "x" }], canBrowse: false } })).toBe(false);
    expect(isConsultReply({ ok: true, value: { kind: "entries", entries: [{ ...entry, detail: 3 }], canBrowse: false } })).toBe(false);
    expect(isConsultReply({ ok: true, value: { kind: "entries", entries: [{ ...entry, group: 3 }], canBrowse: false } })).toBe(false);
    expect(isConsultReply({ ok: true, value: { kind: "entries", entries: [null], canBrowse: false } })).toBe(false);
  });

  it("7.1d rejects pdf, marks and picked replies with bad fields", () => {
    expect(isConsultReply({ ok: true, value: { kind: "pdf" } })).toBe(false);
    expect(isConsultReply({ ok: true, value: { kind: "pdf", base64: 12 } })).toBe(false);
    expect(isConsultReply({ ok: true, value: { kind: "marks", annotations: [] } })).toBe(false);
    expect(isConsultReply({ ok: true, value: { kind: "marks", annotations: {}, notesText: null } })).toBe(false);
    expect(isConsultReply({ ok: true, value: { kind: "marks", annotations: ["x"], notesText: null } })).toBe(false);
    expect(isConsultReply({ ok: true, value: { kind: "marks", annotations: [], notesText: 5 } })).toBe(false);
    expect(isConsultReply({ ok: true, value: { kind: "picked" } })).toBe(false);
    expect(isConsultReply({ ok: true, value: { kind: "picked", entry: "a.ts" } })).toBe(false);
    expect(isConsultReply({ ok: true, value: { kind: "picked", entry: { label: "x" } } })).toBe(false);
  });

  it("7.1d rejects null, arrays and non-objects", () => {
    for (const value of [null, undefined, [], [{ ok: false, error: "x" }], "ok", 3, true]) {
      expect(isConsultReply(value)).toBe(false);
    }
  });
});
