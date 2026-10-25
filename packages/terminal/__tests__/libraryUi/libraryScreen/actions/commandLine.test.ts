import { promises as fs } from "node:fs";
import * as path from "node:path";

import type { AppContext } from "../../../../src/compositionRoot";
import { ALL, App } from "../../../../src/libraryUi/libraryScreen";
import {
  ATTENTION, BERT, EINSTEIN, FakeTerminal, LECUN, ZEBRA, eventually, exists, idle, makeTmpRoot, openApp, pane, press, seedLibrary, typeText,
  writePaper,
} from "../../../fixtures/appHarness";

let tmp: string;
let root: string;
let ctx: AppContext;
let term: FakeTerminal;
let app: App;

beforeEach(async () => {
  ({ tmp, root } = await makeTmpRoot());
  await seedLibrary(root);
  ({ ctx, term, app } = await openApp(root, tmp));
});

afterEach(async () => {
  await idle(app).catch(() => undefined);
  await ctx.dispose();
  await fs.rm(tmp, { recursive: true, force: true });
});

function command(app: App, line: string): void {
  press(app, ":");
  typeText(app, line);
  press(app, "enter");
}

describe("App command line (:)", () => {
  it("opens a command prompt with a hint", () => {
    press(app, ":");
    expect(app.overlay?.kind).toBe("prompt");
    const text = app.frame().screen.toText();
    expect(text).toContain("Command");
    expect(text).toContain("reload · export");
    press(app, "esc");
    expect(app.overlay).toBeUndefined();
  });

  it("navigates with cd", () => {
    command(app, "cd ML/Transformers");
    expect(app.folder).toBe("ML/Transformers");
    expect(app.focus).toBe("papers");
    expect(app.papers().map((p) => p.record.id)).toEqual([ATTENTION, BERT]);
  });

  it("accepts a papers/ prefix and surrounding slashes", () => {
    command(app, "cd papers/Physics");
    expect(app.folder).toBe("Physics");
    command(app, "cd /ML/");
    expect(app.folder).toBe("ML");
  });

  it("goes to All papers with a bare cd", () => {
    command(app, "cd Physics");
    command(app, "cd");
    expect(app.folder).toBe(ALL);
  });

  it("warns about a folder that does not exist", () => {
    command(app, "cd Nope");
    expect(app.folder).toBe(ALL);
    expect(app.message?.text).toBe('No folder "Nope"');
    expect(app.message?.level).toBe("warn");
  });

  it("sorts with sort <key> [desc]", () => {
    command(app, "sort year");
    expect(app.sort).toEqual({ key: "year", reverse: false });
    expect(app.papers()[0]!.record.id).toBe(ZEBRA);
    command(app, "sort year desc");
    expect(app.sort).toEqual({ key: "year", reverse: true });
    expect(app.papers()[0]!.record.id).toBe(EINSTEIN);
    expect(app.message?.text).toBe("Sorted by year, reversed");
  });

  it("rejects an unknown sort key", () => {
    command(app, "sort bogus");
    expect(app.sort.key).toBe("title");
    expect(app.message?.text).toContain('Unknown sort key "bogus"');
  });

  it("creates a folder with mkdir", async () => {
    command(app, "mkdir Biology");
    await idle(app);
    expect(await exists(path.join(root, "papers", "Biology"))).toBe(true);
  });

  it("explains the usage of mkdir, add and export without arguments", () => {
    command(app, "mkdir");
    expect(app.message?.text).toBe("Usage: :mkdir <name>");
    command(app, "add");
    expect(app.message?.text).toBe("Usage: :add <pdf | folder | url | doi | arxiv id>");
    command(app, "export");
    expect(app.message?.text).toBe("Usage: :export <file.bib>");
  });

  it("exports BibTeX to a file", async () => {
    const file = path.join(tmp, "all.bib");
    command(app, `export ${file}`);
    await idle(app);
    const bib = await fs.readFile(file, "utf8");
    for (const id of [ATTENTION, BERT, LECUN, EINSTEIN, ZEBRA]) {
      expect(bib).toContain(`@article{${id},`);
    }
    expect(app.message?.text).toBe(`5 BibTeX entries written to ${file}`);
  });

  it("shows where the library lives", () => {
    command(app, "where");
    expect(app.message?.text).toContain(`Library: ${path.resolve(root)}`);
    expect(app.message?.text).toContain("terminal.log");
  });

  it("reloads the library from disk", async () => {
    await writePaper(root, { id: "new2021paper", folder: "", title: "A Brand New Paper", year: 2021, pdf: true });
    command(app, "reload");
    await eventually(() => app.message?.text === "Library reloaded", "the reload", app);
    expect(pane(app, "papers")).toContain("A Brand New Paper");
  });

  it("complains about an unknown command", () => {
    command(app, "frobnicate now");
    expect(app.message?.text).toBe('Unknown command "frobnicate" — ? lists the keys');
    expect(app.message?.level).toBe("warn");
  });

  it("ignores an empty command", () => {
    command(app, "");
    expect(app.overlay).toBeUndefined();
    expect(app.message).toBeUndefined();
  });

  it("quits with :q, leaving the terminal", async () => {
    command(app, "q");
    await eventually(() => term.left === 1, "the terminal to be released", app);
  });
});
