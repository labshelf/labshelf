import { promises as fs, readFileSync, writeFileSync } from "node:fs";
import * as path from "node:path";

import type { AppContext } from "../../../../src/app/context";
import * as system from "../../../../src/platform/system";
import { App } from "../../../../src/ui/app";
import {
  ATTENTION, BERT, EINSTEIN, ZEBRA, eventually, exists, hoveredId, idle, makeTmpRoot, openApp, pane, paperDir, press, readMeta, screenText,
  seedLibrary, typeText,
} from "../../../fixtures/appHarness";

jest.mock("../../../../src/platform/system", () => ({
  ...jest.requireActual<typeof import("../../../../src/platform/system")>("../../../../src/platform/system"),
  runEditor: jest.fn(),
}));

const mocked = { runEditor: jest.mocked(system.runEditor) };

let tmp: string;
let root: string;
let ctx: AppContext;
let app: App;

beforeEach(async () => {
  mocked.runEditor.mockReset().mockReturnValue(true);
  ({ tmp, root } = await makeTmpRoot());
  await seedLibrary(root);
  ({ ctx, app } = await openApp(root, tmp));
});

afterEach(async () => {
  await idle(app).catch(() => undefined);
  await ctx.dispose();
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("App marking status (m)", () => {
  it("marks the selected papers done on disk and keeps their other fields", async () => {
    press(app, "space", "space");
    expect(app.selection.size).toBe(2);
    press(app, "m", "d");
    await idle(app);
    for (const id of [ATTENTION, BERT]) {
      expect((await readMeta(root, "ML/Transformers", id))["status"]).toBe("done");
    }
    const attention = await readMeta(root, "ML/Transformers", ATTENTION);
    expect(attention).toMatchObject({
      title: "Attention Is All You Need",
      authors: ["Ashish Vaswani", "Noam Shazeer"],
      year: 2017,
      citekey: ATTENTION,
      status: "done",
      tags: ["nlp", "transformers"],
      doi: "10.5555/3295222.3295349",
    });
    expect(app.selection.size).toBe(0);
    expect(app.message?.text).toBe("2 items marked done");
    expect(pane(app, "status")).toContain("2 items marked done");
  });

  it("does not touch papers that were not selected", async () => {
    const before = await fs.readFile(path.join(paperDir(root, "Physics", EINSTEIN), "metadata.yaml"), "utf8");
    press(app, "space", "m", "d");
    await idle(app);
    expect(await fs.readFile(path.join(paperDir(root, "Physics", EINSTEIN), "metadata.yaml"), "utf8")).toBe(before);
    expect((await readMeta(root, "ML/Transformers", BERT))["status"]).toBe("reading");
  });

  it("marks the hovered paper when nothing is selected", async () => {
    press(app, "m", "r");
    await idle(app);
    expect((await readMeta(root, "ML/Transformers", ATTENTION))["status"]).toBe("reading");
    expect(app.message?.text).toBe("1 item marked reading");
  });

  it("marks a paper unread", async () => {
    press(app, "j", "m", "u");
    await idle(app);
    expect((await readMeta(root, "ML/Transformers", BERT))["status"]).toBe("unread");
  });

  it("shows the new status in the list", async () => {
    press(app, "m", "d");
    await idle(app);
    expect(pane(app, "papers").split("\n")[0]).toContain("●");
    expect(pane(app, "preview")).toContain("Status ● done");
  });

  it("writes the BibTeX file next to the metadata, like VS Code", async () => {
    press(app, "m", "d");
    await idle(app);
    expect(await exists(path.join(paperDir(root, "ML/Transformers", ATTENTION), "bib.bib"))).toBe(true);
  });

  it("asks to pick papers first when the folders pane has focus and nothing is selected", () => {
    press(app, "h", "m", "d");
    expect(app.message?.text).toBe("Move to the papers (l) or select some first");
    expect(app.message?.level).toBe("warn");
    expect(app.tasks.size).toBe(0);
  });
});

describe("App tags (t)", () => {
  it("opens a prompt with the paper's tags and writes the edited list on Enter", async () => {
    press(app, "t");
    expect(app.overlay?.kind).toBe("prompt");
    expect(screenText(app)).toContain("Tags of Attention Is All You Need");
    expect(screenText(app)).toContain("nlp, transformers,");
    typeText(app, "attention");
    press(app, "enter");
    expect(app.overlay).toBeUndefined();
    await idle(app);
    expect((await readMeta(root, "ML/Transformers", ATTENTION))["tags"]).toEqual(["nlp", "transformers", "attention"]);
    expect(app.message?.text).toBe("Tags: nlp, transformers, attention");
    expect(pane(app, "preview")).toContain("#attention");
  });

  it("replaces the tags when the field is cleared first", async () => {
    press(app, "t", "C-u");
    typeText(app, "deep learning, nlp");
    press(app, "enter");
    await idle(app);
    expect((await readMeta(root, "ML/Transformers", ATTENTION))["tags"]).toEqual(["deep learning", "nlp"]);
  });

  it("removes all tags when the field is left empty", async () => {
    press(app, "t", "C-u", "enter");
    await idle(app);
    const tags = (await readMeta(root, "ML/Transformers", ATTENTION))["tags"];
    expect(tags === undefined || (Array.isArray(tags) && tags.length === 0)).toBe(true);
    expect(app.message?.text).toBe("Tags cleared");
  });

  it("keeps the other metadata when only the tags change", async () => {
    press(app, "t");
    typeText(app, "x");
    press(app, "enter");
    await idle(app);
    expect(await readMeta(root, "ML/Transformers", ATTENTION)).toMatchObject({
      title: "Attention Is All You Need", status: "unread", year: 2017, doi: "10.5555/3295222.3295349",
    });
  });

  it("removes duplicate tags, ignoring case", async () => {
    press(app, "t", "C-u");
    typeText(app, "NLP, nlp, Nlp, other");
    press(app, "enter");
    await idle(app);
    expect((await readMeta(root, "ML/Transformers", ATTENTION))["tags"]).toEqual(["NLP", "other"]);
  });

  it("cancels with Esc and leaves the file alone", async () => {
    const before = await fs.readFile(path.join(paperDir(root, "ML/Transformers", ATTENTION), "metadata.yaml"), "utf8");
    press(app, "t");
    typeText(app, "zzz");
    press(app, "esc");
    expect(app.overlay).toBeUndefined();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(await fs.readFile(path.join(paperDir(root, "ML/Transformers", ATTENTION), "metadata.yaml"), "utf8")).toBe(before);
  });

  it("sends typed keys to the field, not to the main keymap", () => {
    press(app, "t");
    press(app, "j", "G", "d");
    expect(hoveredId(app)).toBe(ATTENTION);
    expect(app.overlay?.kind).toBe("prompt");
    expect(screenText(app)).toContain("transformers, jGd");
  });

  it("edits with the cursor keys", async () => {
    press(app, "t", "C-u");
    typeText(app, "alpha, gamma");
    press(app, "M-b", "left");
    typeText(app, "beta ");
    press(app, "enter");
    await idle(app);
    const tags = (await readMeta(root, "ML/Transformers", ATTENTION))["tags"] as string[];
    expect(tags.join("|")).toBe("alpha|beta gamma");
  });

  it("edits the tags of several selected papers at once with +tag and -tag", async () => {
    press(app, "space", "space", "t");
    expect(screenText(app)).toContain("Tags of 2 papers");
    typeText(app, "foo -nlp");
    press(app, "enter");
    await idle(app);
    expect((await readMeta(root, "ML/Transformers", ATTENTION))["tags"]).toEqual(["transformers", "foo"]);
    expect((await readMeta(root, "ML/Transformers", BERT))["tags"]).toEqual(["foo"]);
    expect(app.selection.size).toBe(0);
    expect(app.message?.text).toBe("2 items updated");
  });

  it("asks for papers first in the folders pane", () => {
    press(app, "h", "t");
    expect(app.overlay).toBeUndefined();
    expect(app.message?.text).toBe("Move to the papers (l) or select some first");
  });
});

describe("App editing notes (e)", () => {
  it("opens $EDITOR on the current note and saves what the user wrote", async () => {
    let seen = "";
    mocked.runEditor.mockImplementation((file: string) => {
      seen = readFileSync(file, "utf8");
      writeFileSync(file, "Revised note\nwith two lines\n");
      return true;
    });
    press(app, "G", "e");
    await eventually(async () => (await readMeta(root, "", ZEBRA))["note"] === "Revised note\nwith two lines", "the note to be saved", app);
    expect(seen).toBe("Check the stripes");
    await eventually(() => app.message?.text === "Note saved", "the message", app);
  });

  it("does not rewrite the paper when the note is unchanged", async () => {
    const file = path.join(paperDir(root, "", ZEBRA), "metadata.yaml");
    const before = await fs.readFile(file, "utf8");
    press(app, "G", "e");
    await eventually(() => mocked.runEditor.mock.calls.length === 1, "the editor to run", app);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(await fs.readFile(file, "utf8")).toBe(before);
  });

  it("clears the note when the user empties it", async () => {
    mocked.runEditor.mockImplementation((file: string) => {
      writeFileSync(file, "\n");
      return true;
    });
    press(app, "G", "e");
    await eventually(() => app.message?.text === "Note cleared", "the message", app);
    expect(["", undefined]).toContain((await readMeta(root, "", ZEBRA))["note"]);
  });

  it("does not save when the editor fails", async () => {
    mocked.runEditor.mockImplementation((file: string) => {
      writeFileSync(file, "Half-written");
      return false;
    });
    press(app, "G", "e");
    await eventually(() => app.message?.level === "warn", "the warning", app);
    expect(app.message?.text).toBe("The editor exited with an error; note not saved");
    expect((await readMeta(root, "", ZEBRA))["note"]).toBe("Check the stripes");
  });
});
