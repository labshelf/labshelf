// Tests for the terminal's handling of paper notes (D13): `show` prints the items of notes.qmd, the note key opens
// notes.qmd itself in $EDITOR and reloads it, the preview shows the last item, and search finds note text.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { promises as fs } from "node:fs";
import * as path from "node:path";

import type { AppContext } from "../../src/compositionRoot";
import * as system from "../../src/platform/system";
import { App } from "../../src/libraryUi/libraryScreen";
import { CliSessionHarness, PAPERS } from "../fixtures/cliSession";
import type { TempLibrary } from "../fixtures/library";
import {
  ATTENTION, ZEBRA, eventually, idle, ids, makeTmpRoot, openApp, pane, press, seedLibrary, typeText, writeFile,
} from "../fixtures/appHarness";

jest.mock("../../src/platform/system", () => ({
  ...jest.requireActual<typeof import("../../src/platform/system")>("../../src/platform/system"),
  runEditor: jest.fn(),
}));

const mocked = { runEditor: jest.mocked(system.runEditor) };

const ITEM_ONE = "n-01JB2Q8Z5K7M3V9X4C6T8R2W0Y";
const ITEM_TWO = "n-01JB2Q9A1B2C3D4E5F6G7H8J9K";

function item(id: string, created: string, body: string, anchor?: string): string {
  const anchorAttr = anchor ? ` anchor="${anchor}"` : "";
  return `::: {#${id} .labshelf-item${anchorAttr} author="Ana" created="${created}"}\n${body}\n:::\n`;
}

const TWO_ITEMS =
  item(ITEM_ONE, "2026-10-22T12:00:00.000Z", "First thought about the method.\nSecond line of the first note.") +
  "\n" +
  item(ITEM_TWO, "2026-10-23T12:00:00.000Z", "The bound is tight when $\\epsilon \\to 0$.", "p10 box 0.12 0.4 0.3 0.1");

async function writeNotes(lib: TempLibrary, id: string, text: string): Promise<void> {
  const file = lib.paths.layout.paperNotesPath(id);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, text);
}

describe("show prints the notes of notes.qmd", () => {
  let harness: CliSessionHarness;

  beforeEach(async () => {
    harness = new CliSessionHarness();
    await harness.setup();
  });

  afterEach(async () => {
    await harness.teardown();
  });

  it("6.7a prints both bodies of a paper with two items, each under its dated line", async () => {
    const s = await harness.session(PAPERS, { prepare: (lib) => writeNotes(lib, "devlin2019bert", TWO_ITEMS) });
    expect(await s.run("show", "devlin2019bert")).toBe(0);
    const lines = s.text().split("\n");
    const headers = lines.map((l, i) => [l, i] as const).filter(([l]) => l.startsWith("— "));
    expect(headers).toHaveLength(2);
    const [[head1, at1], [head2, at2]] = headers as [readonly [string, number], readonly [string, number]];
    expect(head1).toContain("2026-10-22");
    expect(head2).toContain("2026-10-23");

    const first = lines.indexOf("First thought about the method.");
    const firstTail = lines.indexOf("Second line of the first note.");
    const second = lines.indexOf("The bound is tight when $\\epsilon \\to 0$.");
    expect(first).toBeGreaterThan(at1);
    expect(firstTail).toBe(first + 1);
    expect(first).toBeLessThan(at2);
    expect(second).toBeGreaterThan(at2);
  });

  it("6.7a prints loose text of notes.qmd as is", async () => {
    const loose = "Remember to check the appendix.";
    const s = await harness.session(PAPERS, {
      prepare: (lib) => writeNotes(lib, "devlin2019bert", `${loose}\n\n${item(ITEM_ONE, "2026-10-22T12:00:00.000Z", "An item body.")}`),
    });
    expect(await s.run("show", "devlin2019bert")).toBe(0);
    const lines = s.text().split("\n");
    expect(lines).toContain(loose);
    expect(lines).toContain("An item body.");
    expect(lines.filter((l) => l.startsWith("— "))).toHaveLength(1);
  });

  it("6.7a prints a file with only loose text without losing it", async () => {
    const s = await harness.session(PAPERS, { prepare: (lib) => writeNotes(lib, "devlin2019bert", "Just a hand-written line.\n") });
    expect(await s.run("show", "devlin2019bert")).toBe(0);
    expect(s.text().split("\n")).toContain("Just a hand-written line.");
  });

  it("6.7a prints no notes block for a paper without notes.qmd", async () => {
    const s = await harness.session();
    expect(await s.run("show", "notes2020")).toBe(0);
    const lines = s.text().split("\n");
    expect(lines.some((l) => l.startsWith("— "))).toBe(false);
    expect(lines).not.toContain("note:");
  });

  it("6.7a prints no notes block for an empty notes.qmd", async () => {
    const s = await harness.session(PAPERS, { prepare: (lib) => writeNotes(lib, "notes2020", "") });
    expect(await s.run("show", "notes2020")).toBe(0);
    expect(s.text().split("\n").some((l) => l.startsWith("— "))).toBe(false);
  });

  it("A4 shows the notes of notes.qmd and ignores a note key left in metadata.yaml", async () => {
    const s = await harness.session(PAPERS, {
      prepare: (lib) => writeNotes(lib, "vaswani2017attention", item(ITEM_ONE, "2026-10-22T12:00:00.000Z", "From the notes file.")),
    });
    expect(await s.run("show", "vaswani2017attention")).toBe(0);
    expect(s.text()).toContain("From the notes file.");
    expect(s.text()).not.toContain("Read section 3");
    expect(s.text().split("\n")).not.toContain("note:");
  });

  it("A4 prints a legacy note key of metadata.yaml nowhere, also without notes.qmd", async () => {
    const s = await harness.session();
    expect(await s.run("show", "vaswani2017attention")).toBe(0);
    expect(s.text()).not.toContain("Read section 3");
  });

  it("A4 keeps the note key out of the record printed by show --json", async () => {
    const s = await harness.session();
    expect(await s.run("show", "vaswani2017attention", "--json")).toBe(0);
    expect(JSON.parse(s.text())).not.toHaveProperty("note");
  });

  it("A4 finds a paper through the text of its notes.qmd in a one-shot search", async () => {
    const s = await harness.session(PAPERS, {
      prepare: (lib) => writeNotes(lib, "he2016resnet", item(ITEM_ONE, "2026-10-22T12:00:00.000Z", "A zanzibarquokka idea.")),
    });
    expect(await s.run("search", "zanzibarquokka")).toBe(0);
    expect(s.text()).toContain("he2016resnet");
  });

  it("A4 matches note:word and has:note from notes.qmd", async () => {
    const s = await harness.session(PAPERS, {
      prepare: (lib) => writeNotes(lib, "he2016resnet", item(ITEM_ONE, "2026-10-22T12:00:00.000Z", "A zanzibarquokka idea.")),
    });
    expect(await s.run("search", "note:zanzibarquokka")).toBe(0);
    expect(s.text()).toContain("he2016resnet");
    s.out.length = 0;
    expect(await s.run("search", "has:note")).toBe(0);
    expect(s.text().split("\n").map((l) => l.split(/\s{2,}/)[1])).toEqual(["he2016resnet"]);
  });
});

describe("the note key opens notes.qmd in $EDITOR", () => {
  let tmp: string;
  let root: string;
  let ctx: AppContext;
  let app: App;

  const notesFile = (id: string): string => path.join(root, ".research", "papers", id, "notes.qmd");

  async function open(): Promise<void> {
    ({ ctx, app } = await openApp(root, tmp));
  }

  beforeEach(async () => {
    mocked.runEditor.mockReset().mockReturnValue(true);
    ({ tmp, root } = await makeTmpRoot());
    await seedLibrary(root);
  });

  afterEach(async () => {
    if (app) { await idle(app).catch(() => undefined); }
    if (ctx) { await ctx.dispose(); }
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("6.7b opens the notes.qmd of the hovered paper itself, not a temp copy", async () => {
    await writeFile(notesFile(ATTENTION), TWO_ITEMS);
    await open();
    let seenFile = "";
    let seenText = "";
    mocked.runEditor.mockImplementation((file: string) => {
      seenFile = file;
      seenText = readFileSync(file, "utf8");
      return true;
    });
    press(app, "e");
    await eventually(() => mocked.runEditor.mock.calls.length === 1, "the editor to run", app);
    expect(seenFile).toBe(notesFile(ATTENTION));
    expect(seenText).toBe(TWO_ITEMS);
  });

  it("6.7b creates notes.qmd empty when it is missing", async () => {
    await open();
    let existed = false;
    let seenText = "unset";
    mocked.runEditor.mockImplementation((file: string) => {
      existed = existsSync(file);
      seenText = existed ? readFileSync(file, "utf8") : "missing";
      return true;
    });
    press(app, "G", "e");
    await eventually(() => mocked.runEditor.mock.calls.length === 1, "the editor to run", app);
    expect(mocked.runEditor.mock.calls[0]![0]).toBe(notesFile(ZEBRA));
    expect(existed).toBe(true);
    expect(seenText).toBe("");
  });

  it("6.7b reloads the notes after the editor exits, so the preview shows what the user wrote", async () => {
    await open();
    mocked.runEditor.mockImplementation((file: string) => {
      writeFileSync(file, item(ITEM_ONE, "2026-10-22T12:00:00.000Z", "Written inside the editor."));
      return true;
    });
    press(app, "e");
    await eventually(() => pane(app, "preview").includes("Written inside the editor."), "the preview to show the new note", app);
  });

  it("6.7b reloads the notes for search after the editor exits", async () => {
    await open();
    mocked.runEditor.mockImplementation((file: string) => {
      writeFileSync(file, item(ITEM_ONE, "2026-10-22T12:00:00.000Z", "A zanzibarquokka idea."));
      return true;
    });
    press(app, "e");
    await eventually(() => mocked.runEditor.mock.calls.length === 1, "the editor to run", app);
    await idle(app);
    press(app, "f");
    typeText(app, "zanzibarquokka");
    await eventually(() => ids(app).join(",") === ATTENTION, "the filter to find the note", app);
  });

  it("6.7b does not write metadata.yaml when the editor changes notes.qmd", async () => {
    await open();
    const metadata = path.join(root, "papers", "ML", "Transformers", ATTENTION, "metadata.yaml");
    const before = await fs.readFile(metadata, "utf8");
    mocked.runEditor.mockImplementation((file: string) => {
      writeFileSync(file, item(ITEM_ONE, "2026-10-22T12:00:00.000Z", "Only in the notes file."));
      return true;
    });
    press(app, "e");
    await eventually(() => pane(app, "preview").includes("Only in the notes file."), "the preview to show the new note", app);
    expect(await fs.readFile(metadata, "utf8")).toBe(before);
  });

  it("6.7b shows the existing warning when the editor fails", async () => {
    await open();
    mocked.runEditor.mockReturnValue(false);
    press(app, "e");
    await eventually(() => app.message?.level === "warn", "the warning", app);
    expect(app.message?.text).toMatch(/editor exited with an error/);
  });

  it("6.7 shows the first lines of the last item in the preview", async () => {
    await writeFile(notesFile(ATTENTION), TWO_ITEMS);
    await open();
    await eventually(() => pane(app, "preview").includes("The bound is tight"), "the preview to show the last item", app);
    expect(pane(app, "preview")).not.toContain("First thought about the method.");
  });

  it("6.7 shows no note section in the preview of a paper without notes", async () => {
    await open();
    press(app, "G");
    await eventually(() => pane(app, "preview").includes("Zebra Study"), "the preview to show the paper", app);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(pane(app, "preview")).not.toContain("Read section 3");
    expect(pane(app, "preview")).not.toContain("Check the stripes");
  });
});
