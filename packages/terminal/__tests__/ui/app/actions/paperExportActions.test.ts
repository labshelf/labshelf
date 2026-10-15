import { promises as fs } from "node:fs";
import * as path from "node:path";

import type { AppContext } from "../../../../src/app/context";
import * as system from "../../../../src/platform/system";
import { App } from "../../../../src/ui/app";
import {
  ATTENTION, BERT, EINSTEIN, FakeTerminal, LECUN, ZEBRA, eventually, goToFolder, highlight, hoveredId, idle, ids, makeTmpRoot, openApp,
  paperDir, press, seedLibrary, typeText, writeSidecar,
} from "../../../fixtures/appHarness";

jest.mock("../../../../src/platform/system", () => ({
  ...jest.requireActual<typeof import("../../../../src/platform/system")>("../../../../src/platform/system"),
  openExternal: jest.fn(),
  revealInFileManager: jest.fn(),
  copyToClipboard: jest.fn(),
}));

const mocked = {
  openExternal: jest.mocked(system.openExternal),
  revealInFileManager: jest.mocked(system.revealInFileManager),
  copyToClipboard: jest.mocked(system.copyToClipboard),
};

let tmp: string;
let root: string;
let ctx: AppContext;
let term: FakeTerminal;
let app: App;

beforeEach(async () => {
  mocked.openExternal.mockReset();
  mocked.revealInFileManager.mockReset();
  mocked.copyToClipboard.mockReset().mockResolvedValue("system");
  ({ tmp, root } = await makeTmpRoot());
  await seedLibrary(root);
  ({ ctx, term, app } = await openApp(root, tmp));
});

afterEach(async () => {
  await idle(app).catch(() => undefined);
  await ctx.dispose();
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("App sorting (,)", () => {
  it("sorts by year, newest first, and shows it in the status bar", () => {
    press(app, ",", "y");
    expect(app.sort).toEqual({ key: "year", reverse: false });
    expect(ids(app)).toEqual([ZEBRA, BERT, ATTENTION, LECUN, EINSTEIN]);
    expect(app.message?.text).toBe("Sorted by year");
  });

  it("reverses with the capital letter", () => {
    press(app, ",", "Y");
    expect(app.sort).toEqual({ key: "year", reverse: true });
    expect(ids(app)).toEqual([EINSTEIN, LECUN, ATTENTION, BERT, ZEBRA]);
  });

  it("sorts by first author", () => {
    press(app, ",", "a");
    expect(ids(app)).toEqual([BERT, EINSTEIN, LECUN, ATTENTION, ZEBRA]);
  });

  it("sorts by status: unread, then reading, then done", () => {
    press(app, ",", "s");
    expect(ids(app)).toEqual([ATTENTION, ZEBRA, BERT, LECUN, EINSTEIN]);
  });

  it("goes back to title order", () => {
    press(app, ",", "y", ",", "t");
    expect(ids(app)).toEqual([ATTENTION, BERT, LECUN, EINSTEIN, ZEBRA]);
  });

  it("keeps the same paper hovered when the order changes", () => {
    press(app, "j");
    expect(hoveredId(app)).toBe(BERT);
    press(app, ",", "y");
    expect(hoveredId(app)).toBe(BERT);
  });
});

describe("App copying (y) and opening", () => {
  const copied = (): string[] => mocked.copyToClipboard.mock.calls.map((call) => call[0]);
  const copiedOnce = async (): Promise<string> => {
    await eventually(() => mocked.copyToClipboard.mock.calls.length === 1, "the clipboard to be written", app);
    return copied()[0]!;
  };

  it("copies the cite key with y k", async () => {
    press(app, "y", "k");
    expect(await copiedOnce()).toBe(ATTENTION);
    await eventually(() => app.message?.text === `Copied ${ATTENTION}`, "the message", app);
  });

  it("copies the cite keys of all selected papers, separated by commas", async () => {
    press(app, "space", "space", "y", "k");
    expect(await copiedOnce()).toBe(`${ATTENTION}, ${BERT}`);
    await eventually(() => app.message?.text === "Copied cite keys (2)", "the message", app);
  });

  it("copies a \\cite command with y c", async () => {
    press(app, "space", "space", "y", "c");
    expect(await copiedOnce()).toBe(`\\cite{${ATTENTION},${BERT}}`);
  });

  it("copies the DOI as a link with y d, and warns when there is none", async () => {
    press(app, "y", "d");
    expect(await copiedOnce()).toBe("https://doi.org/10.5555/3295222.3295349");
    mocked.copyToClipboard.mockClear();
    press(app, "j", "y", "d");
    await eventually(() => app.message?.text === "No DOI or URL stored", "the warning", app);
    expect(mocked.copyToClipboard).not.toHaveBeenCalled();
  });

  it("copies the title with y t", async () => {
    press(app, "y", "t");
    expect(await copiedOnce()).toBe("Attention Is All You Need");
  });

  it("copies the PDF path with y p", async () => {
    press(app, "y", "p");
    expect(await copiedOnce()).toBe(path.join(paperDir(root, "ML/Transformers", ATTENTION), "paper.pdf"));
  });

  it("copies BibTeX with y b", async () => {
    press(app, "y", "b");
    const text = await copiedOnce();
    expect(text).toContain(`@article{${ATTENTION},`);
    expect(text).toContain("title = {Attention Is All You Need}");
  });

  it("copies the highlights as Markdown with y m", async () => {
    await writeSidecar(root, ATTENTION, [highlight(ATTENTION, 3, "Scaled dot-product attention")]);
    press(app, "y", "m");
    expect(await copiedOnce()).toContain("Scaled dot-product attention");
  });

  it("says when the clipboard cannot be reached", async () => {
    mocked.copyToClipboard.mockResolvedValue("failed");
    press(app, "y", "k");
    await eventually(() => app.message?.text === "Could not reach the clipboard", "the message", app);
    expect(app.message?.level).toBe("error");
  });

  it("hands the OSC 52 fallback to the terminal", async () => {
    mocked.copyToClipboard.mockImplementation(async (_text, osc52) => {
      osc52?.("\x1b]52;c;Zm9v\x07");
      return "osc52";
    });
    press(app, "y", "k");
    await eventually(() => term.raw.includes("\x1b]52;c;Zm9v\x07"), "the escape sequence", app);
  });

  it("asks for papers first in the folders pane", () => {
    press(app, "h", "y", "k");
    expect(app.message?.text).toBe("Move to the papers (l) or select some first");
    expect(mocked.copyToClipboard).not.toHaveBeenCalled();
  });

  it("opens the PDF of the hovered paper with o and with l", () => {
    press(app, "o");
    expect(mocked.openExternal).toHaveBeenCalledTimes(1);
    expect(mocked.openExternal.mock.calls[0]![0]).toBe(path.join(paperDir(root, "ML/Transformers", ATTENTION), "paper.pdf"));
    expect(app.message?.text).toBe("Opened Attention Is All You Need");
    press(app, "j", "l");
    expect(mocked.openExternal).toHaveBeenCalledTimes(2);
    expect(mocked.openExternal.mock.calls[1]![0]).toBe(path.join(paperDir(root, "ML/Transformers", BERT), "paper.pdf"));
  });

  it("opens the PDF when Enter is pressed on a paper", () => {
    press(app, "enter");
    expect(mocked.openExternal).toHaveBeenCalledTimes(1);
  });

  it("does not open anything for a paper whose PDF is not on this device", () => {
    goToFolder(app, "Physics");
    press(app, "l", "l");
    expect(mocked.openExternal).not.toHaveBeenCalled();
    expect(app.message?.text).toBe(`No PDF on this device for ${EINSTEIN}`);
    expect(app.message?.level).toBe("warn");
    press(app, "o");
    expect(mocked.openExternal).not.toHaveBeenCalled();
  });

  it("reveals the paper's folder, or the hovered folder, in the file manager", () => {
    press(app, "O");
    expect(mocked.revealInFileManager).toHaveBeenLastCalledWith(paperDir(root, "ML/Transformers", ATTENTION));
    goToFolder(app, "ML");
    press(app, "O");
    expect(mocked.revealInFileManager).toHaveBeenLastCalledWith(path.join(root, "papers", "ML"));
  });
});

describe("App export (B)", () => {
  it("offers a default file name and the number of entries", () => {
    press(app, "B");
    expect(app.overlay?.kind === "prompt" && app.overlay.input.value).toBe("./library.bib");
    const text1 = app.frame().screen.toText();
    expect(text1).toContain("Export BibTeX");
    expect(text1).toContain("5 entries");
    press(app, "esc");
    goToFolder(app, "ML");
    press(app, "B");
    expect(app.overlay?.kind === "prompt" && app.overlay.input.value).toBe("./ML.bib");
    expect(app.frame().screen.toText()).toContain("3 entries");
  });

  it("writes the BibTeX of the selected papers to the chosen file", async () => {
    const file = path.join(tmp, "selection.bib");
    press(app, "space", "space", "B", "C-u");
    typeText(app, file);
    press(app, "enter");
    await idle(app);
    const bib = await fs.readFile(file, "utf8");
    expect(bib).toContain(`@article{${ATTENTION},`);
    expect(bib).toContain(`@article{${BERT},`);
    expect(bib).not.toContain(`@article{${ZEBRA},`);
    expect(app.message?.text).toBe(`2 BibTeX entries written to ${file}`);
  });

  it("exports the papers of the folder, subfolders included", async () => {
    const file = path.join(tmp, "ml.bib");
    goToFolder(app, "ML");
    press(app, "B", "C-u");
    typeText(app, file);
    press(app, "enter");
    await idle(app);
    const bib = await fs.readFile(file, "utf8");
    expect(bib).toContain(`@article{${LECUN},`);
    expect(bib).toContain(`@article{${ATTENTION},`);
    expect(bib).not.toContain(`@article{${EINSTEIN},`);
  });

  it("exports only the filtered papers", async () => {
    const file = path.join(tmp, "filtered.bib");
    press(app, "f");
    typeText(app, "tag:nlp");
    press(app, "enter", "B", "C-u");
    typeText(app, file);
    press(app, "enter");
    await idle(app);
    const bib = await fs.readFile(file, "utf8");
    expect(bib).toContain(`@article{${ATTENTION},`);
    expect(bib).not.toContain(`@article{${BERT},`);
  });
});
