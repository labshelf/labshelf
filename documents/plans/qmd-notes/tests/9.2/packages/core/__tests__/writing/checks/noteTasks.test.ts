/** Verifies scanning `- [ ]` / `- [x]` tasks out of project notes and ticking one through ProjectNotesStore. */
import { createProjectNotesStore, type IProjectNoteFiles } from "../../../src/qmd/projectNotes/projectNotesStore";
import { scanNoteTasks, toggleNoteTask, type NoteTask } from "../../../src/writing/checks/noteTasks";
import { fakeLogger } from "../../support/fakeLogger";

const PROJECT = "proj-1";
const FILE = "notes/plan.qmd";
const ID_A = "n-01JB2Q8Z5K7M3V9X4C6T8R2W0Y";
const ID_B = "n-01JB2Q8Z5K7M3V9X4C6T8R2W1Z";
const OUTPUT_OPEN = '::: {.labshelf-output cell="c1" source="abcdef012345" engine="python" ran="2026-10-22T09:12:00.000Z"}';

const NOTE = [
  "Loose intro",
  "",
  `::: {#${ID_A} .labshelf-item author="Ana" created="2026-10-22T09:12:00.000Z"}`,
  "# Plan",
  "- [ ] Ask Ana",
  "- [x] Read paper",
  "Some prose.",
  ":::",
  "",
  `::: {#${ID_B} .labshelf-item}`,
  "- [ ] Second item task",
  ":::",
  "",
].join("\n");

/** In-memory port that counts writes. */
function memoryFiles(initial: Record<string, string>) {
  const files = new Map(Object.entries(initial));
  let writes = 0;
  const port: IProjectNoteFiles = {
    list: async () => [...files.keys()],
    read: async (_projectId, path) => files.get(path) ?? null,
    write: async (_projectId, path, text) => { writes++; files.set(path, text); },
  };
  return { files, port, writes: () => writes };
}

function storeOver(initial: Record<string, string>) {
  const memory = memoryFiles(initial);
  return { ...memory, store: createProjectNotesStore(memory.port, fakeLogger()) };
}

function task(overrides: Partial<NoteTask> = {}): NoteTask {
  return { file: FILE, itemId: ID_A, line: 4, text: "Ask Ana", done: false, ...overrides };
}

function replaceLine(text: string, line: number, value: string): string {
  const lines = text.split("\n");
  lines[line] = value;
  return lines.join("\n");
}

describe("scanNoteTasks", () => {
  it("9.2a finds open and done tasks with file, item id, zero-based line, text and state", () => {
    const tasks = scanNoteTasks(FILE, NOTE);
    expect(tasks).toEqual([
      { file: FILE, itemId: ID_A, line: 4, text: "Ask Ana", done: false },
      { file: FILE, itemId: ID_A, line: 5, text: "Read paper", done: true },
      { file: FILE, itemId: ID_B, line: 10, text: "Second item task", done: false },
    ]);
  });

  it("9.2a ignores tasks inside code cells", () => {
    const text = [
      `::: {#${ID_A} .labshelf-item}`,
      "- [ ] real task",
      "```{python}",
      "#| label: c1",
      "# - [ ] comment in a cell",
      'x = "- [x] string in a cell"',
      "- [ ] bare line in a cell",
      "```",
      "- [x] after the cell",
      ":::",
      "",
    ].join("\n");
    expect(scanNoteTasks(FILE, text)).toEqual([
      { file: FILE, itemId: ID_A, line: 1, text: "real task", done: false },
      { file: FILE, itemId: ID_A, line: 8, text: "after the cell", done: true },
    ]);
  });

  it("9.2a ignores tasks inside plain code fences", () => {
    const text = [
      `::: {#${ID_A} .labshelf-item}`,
      "```",
      "- [ ] fenced",
      "```",
      "- [ ] open",
      ":::",
      "",
    ].join("\n");
    expect(scanNoteTasks(FILE, text).map((found) => found.text)).toEqual(["open"]);
  });

  it("9.2a ignores tasks inside output blocks", () => {
    const text = [
      `::: {#${ID_A} .labshelf-item}`,
      "```{python}",
      "#| label: c1",
      "print('- [ ] printed')",
      "```",
      OUTPUT_OPEN,
      "- [ ] printed by the cell",
      "- [x] also printed",
      ":::",
      "- [ ] after the output",
      ":::",
      "",
    ].join("\n");
    expect(scanNoteTasks(FILE, text)).toEqual([
      { file: FILE, itemId: ID_A, line: 9, text: "after the output", done: false },
    ]);
  });

  it("9.2a reads no task from loose text outside items", () => {
    const text = `- [ ] loose task\n\n::: {#${ID_A} .labshelf-item}\nNo tasks here.\n:::\n`;
    expect(scanNoteTasks(FILE, text)).toEqual([]);
  });

  it("9.2a reads no task from a note without task lines", () => {
    expect(scanNoteTasks(FILE, "")).toEqual([]);
    expect(scanNoteTasks(FILE, `::: {#${ID_A} .labshelf-item}\n- plain bullet\n:::\n`)).toEqual([]);
  });
});

describe("toggleNoteTask", () => {
  it("9.2b ticks an open task and changes only that line", async () => {
    const { store, files, writes } = storeOver({ [FILE]: NOTE });
    expect(await toggleNoteTask(store, PROJECT, task())).toEqual({ status: "ok" });
    expect(files.get(FILE)).toBe(replaceLine(NOTE, 4, "- [x] Ask Ana"));
    expect(writes()).toBe(1);
  });

  it("9.2b unticks a done task and changes only that line", async () => {
    const { store, files } = storeOver({ [FILE]: NOTE });
    const done = task({ line: 5, text: "Read paper", done: true });
    expect(await toggleNoteTask(store, PROJECT, done)).toEqual({ status: "ok" });
    expect(files.get(FILE)).toBe(replaceLine(NOTE, 5, "- [ ] Read paper"));
  });

  it("9.2b edits the task of the second item and leaves the first untouched", async () => {
    const { store, files } = storeOver({ [FILE]: NOTE });
    const second = task({ itemId: ID_B, line: 10, text: "Second item task" });
    expect(await toggleNoteTask(store, PROJECT, second)).toEqual({ status: "ok" });
    expect(files.get(FILE)).toBe(replaceLine(NOTE, 10, "- [x] Second item task"));
  });

  it("9.2b keeps the task text and other tasks' lines identical when ticking", async () => {
    const { store, files } = storeOver({ [FILE]: NOTE });
    await toggleNoteTask(store, PROJECT, task());
    const tasks = scanNoteTasks(FILE, files.get(FILE)!);
    expect(tasks.map((found) => [found.line, found.text, found.done])).toEqual([
      [4, "Ask Ana", true],
      [5, "Read paper", true],
      [10, "Second item task", false],
    ]);
  });

  it("9.2b keeps CRLF line endings of the other lines", async () => {
    const crlf = NOTE.replace(/\n/g, "\r\n");
    const { store, files } = storeOver({ [FILE]: crlf });
    expect(await toggleNoteTask(store, PROJECT, task())).toEqual({ status: "ok" });
    expect(files.get(FILE)).toBe(crlf.replace("- [ ] Ask Ana", "- [x] Ask Ana"));
  });

  it("9.2c refuses when the text of the line changed and leaves the file untouched", async () => {
    const edited = replaceLine(NOTE, 4, "- [ ] Ask Ben instead");
    const { store, files, writes } = storeOver({ [FILE]: edited });
    expect(await toggleNoteTask(store, PROJECT, task())).toEqual({ status: "changed" });
    expect(files.get(FILE)).toBe(edited);
    expect(writes()).toBe(0);
  });

  it("9.2c refuses when lines moved so the line holds something else", async () => {
    const shifted = NOTE.replace("# Plan\n", "# Plan\nA new paragraph.\n");
    const { store, files, writes } = storeOver({ [FILE]: shifted });
    expect(await toggleNoteTask(store, PROJECT, task())).toEqual({ status: "changed" });
    expect(files.get(FILE)).toBe(shifted);
    expect(writes()).toBe(0);
  });

  it("9.2c refuses when the task was already ticked on disk", async () => {
    const ticked = replaceLine(NOTE, 4, "- [x] Ask Ana");
    const { store, files, writes } = storeOver({ [FILE]: ticked });
    expect(await toggleNoteTask(store, PROJECT, task())).toEqual({ status: "changed" });
    expect(files.get(FILE)).toBe(ticked);
    expect(writes()).toBe(0);
  });
});
