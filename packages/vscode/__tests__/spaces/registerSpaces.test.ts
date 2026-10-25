// Verifies Spaces use project checklist signals and reading statuses for progress.
import { readChecklistSignals } from "@labshelf/core";
import { projectChecklist } from "../../src/spaces/registerSpaces.js";

jest.mock("@labshelf/core", () => ({ ...jest.requireActual("@labshelf/core"), readChecklistSignals: jest.fn() }));

it("counts source issues, manual items and resolved reading entries", async () => {
  jest.mocked(readChecklistSignals).mockResolvedValue({ sources: [], todos: [{ file: "main.tex", line: 1, text: "Fix" }], brokenRefs: [], staleFigures: [],
    manual: [{ id: "m", text: "Check", done: true, createdAt: "2026-10-21" }] });
  const writing = { projects: { list: () => [{ kind: "ready", folder: "/project", settings: {} }], reads: jest.fn() },
    readingLists: { of: async () => ({ entries: [{ key: "p", paper: { title: "Paper", status: "done" } }, { key: "missing" }] }) }, logger: {} };
  expect(await projectChecklist(writing as never, { id: "/project" } as never)).toEqual({ done: 2, total: 3 });
});
