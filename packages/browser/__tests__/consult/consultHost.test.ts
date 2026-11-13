import * as Y from "yjs";
import { answerConsult, createPaperFiles, createReplicaHub, deriveReplicaKind, joinWith } from "@labshelf/core";
import type { ILogger, LibraryFileSystem, PaperRecord, Replica } from "@labshelf/core";

const papers: PaperRecord[] = [];
jest.mock("../../src/storage/records", () => ({
  ...jest.requireActual("../../src/storage/records"),
  listCachedPaperRecords: async () => papers,
}));

import { createBrowserConsultIo, createBrowserConsultSetup, createBrowserFileOpener, deriveConsultCodePath } from "../../src/consult/consultHost";
import { createPickedFiles } from "../../src/consult/pickedFile";

const logger = { log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) } as unknown as ILogger;
const settle = async (): Promise<void> => {
  for (let i = 0; i < 6; i += 1) { await new Promise<void>((resolve) => setImmediate(resolve)); }
};

/** A library file system over a map of path to text; folders are implied by the paths. */
function memoryFs(files: Record<string, string>): LibraryFileSystem {
  return {
    readText: async (path: string) => {
      if (!(path in files)) { throw new Error(`missing ${path}`); }
      return files[path]!;
    },
    writeText: async (path: string, text: string) => { files[path] = text; },
    exists: async (path: string) => path in files,
    listDir: async (dir: string) => {
      const prefix = `${dir}/`;
      return [...new Set(Object.keys(files).filter((p) => p.startsWith(prefix)).map((p) => p.slice(prefix.length).split("/")[0]!))];
    },
    stat: async (path: string) => {
      if (path in files) { return { isFile: true, isDirectory: false, mtimeMs: 0, size: files[path]!.length }; }
      return Object.keys(files).some((p) => p.startsWith(`${path}/`)) ? { isFile: false, isDirectory: true, mtimeMs: 0, size: 0 } : undefined;
    },
    ensureDir: async () => undefined,
  } as unknown as LibraryFileSystem;
}

interface FakeLive {
  readonly live: Parameters<typeof createBrowserFileOpener>[0]["live"];
  readonly opened: string[];
  readonly flushes: jest.Mock[];
  readonly releases: jest.Mock[];
  readonly hub: ReturnType<typeof createReplicaHub>;
}

/** The page's LiveFiles over a real replica hub, so two opens of one path share one replica. */
function fakeLive(disk: Record<string, string>): FakeLive {
  const hub = createReplicaHub({ channel: { post: () => undefined, onMessage: () => () => undefined }, peerWaitMs: 0 });
  const opened: string[] = [];
  const flushes: jest.Mock[] = [];
  const releases: jest.Mock[] = [];
  const live = {
    libraryId: "lib",
    open(path: string) {
      opened.push(path);
      const replica: Replica = hub.open(path, deriveReplicaKind(path), async () => {
        if (!(path in disk)) { throw new Error(`missing ${path}`); }
        return disk[path]!;
      });
      const flush = jest.fn(async () => undefined);
      const release = jest.fn(async () => { replica.release(); });
      flushes.push(flush);
      releases.push(release);
      return { replica, flush, release };
    },
  } as unknown as FakeLive["live"];
  return { live, opened, flushes, releases, hub };
}

const FOLDERS: Record<string, string> = { thesis: "projects/thesis" };
const NOTES: Record<string, string> = { p1: "papers/ml/smith/notes.qmd" };

function makeOpener(disk: Record<string, string>) {
  const fake = fakeLive(disk);
  const opener = createBrowserFileOpener({
    live: fake.live,
    picked: createPickedFiles(),
    folderOf: async (projectId) => FOLDERS[projectId],
    notesPathOf: async (paperId) => NOTES[paperId],
  });
  return { fake, opener };
}

describe("9.3 The browser source tab shows the consult footer; manuscripts, project notes, paper notes and library code files open editable as replicas of the page's hub, papers read-only, and on Chromium Browse opens a picked file writable for the page's life (no Browse on Firefox).", () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
    papers.length = 0;
  });

  it("9.3a the opener opens a manuscript ref as the hub path join(folder, path) and returns a text binding over the replica's Y.Text", async () => {
    const { fake, opener } = makeOpener({ "projects/thesis/chapters/one.tex": "Hello" });
    const file = await opener({ kind: "manuscript", projectId: "thesis", path: "chapters/one.tex" });
    expect(fake.opened).toEqual(["projects/thesis/chapters/one.tex"]);
    expect(file.kind).toBe("text");
    if (file.kind !== "text" || !("collab" in file.binding)) { throw new Error("expected a collab text binding"); }
    expect(file.binding.collab.text.toString()).toBe("Hello");
    file.release();
    await settle();
  });

  it("9.3a a qmd note ref returns a live binding over the replica's doc whose persist flushes the LiveFile", async () => {
    const { fake, opener } = makeOpener({ "projects/thesis/notes/idea.qmd": "# Idea\n" });
    const file = await opener({ kind: "projectNote", projectId: "thesis", path: "notes/idea.qmd" });
    expect(fake.opened).toEqual(["projects/thesis/notes/idea.qmd"]);
    expect(file.kind).toBe("qmd");
    if (file.kind !== "qmd" || !("live" in file.binding)) { throw new Error("expected a live binding"); }
    expect(file.binding.live.doc).toBeInstanceOf(Y.Doc);
    expect(fake.flushes[0]).not.toHaveBeenCalled();
    await file.binding.live.persist();
    expect(fake.flushes[0]).toHaveBeenCalledTimes(1);
    file.release();
    await settle();
  });

  it("9.3a release flushes and releases the LiveFile once, however often it is called", async () => {
    const { fake, opener } = makeOpener({ "projects/thesis/main.tex": "x" });
    const file = await opener({ kind: "manuscript", projectId: "thesis", path: "main.tex" });
    file.release();
    file.release();
    await settle();
    expect(fake.flushes[0]).toHaveBeenCalledTimes(1);
    expect(fake.releases[0]).toHaveBeenCalledTimes(1);
    const flushOrder = fake.flushes[0]!.mock.invocationCallOrder[0]!;
    const releaseOrder = fake.releases[0]!.mock.invocationCallOrder[0]!;
    expect(flushOrder).toBeLessThan(releaseOrder);
  });

  it("9.3a a file that fails to load releases its LiveFile and rejects", async () => {
    const { fake, opener } = makeOpener({});
    await expect(opener({ kind: "manuscript", projectId: "thesis", path: "gone.tex" })).rejects.toBeDefined();
    await settle();
    expect(fake.releases[0]).toHaveBeenCalledTimes(1);
  });

  it("9.3b a paperNotes ref opens the paper's notes.qmd hub path", async () => {
    const { fake, opener } = makeOpener({ "papers/ml/smith/notes.qmd": "# Notes\n" });
    const file = await opener({ kind: "paperNotes", paperId: "p1" });
    expect(fake.opened).toEqual(["papers/ml/smith/notes.qmd"]);
    expect(file.kind).toBe("qmd");
    file.release();
    await settle();
  });

  it("9.3b a code ref opens the library-relative path as listed", async () => {
    const { fake, opener } = makeOpener({ "projects/thesis/analysis.py": "print(1)\n" });
    const file = await opener({ kind: "code", path: "projects/thesis/analysis.py" });
    expect(fake.opened).toEqual(["projects/thesis/analysis.py"]);
    expect(file.kind).toBe("text");
    file.release();
    await settle();
  });

  it("9.3b an unknown project rejects without opening a LiveFile", async () => {
    const { fake, opener } = makeOpener({});
    await expect(opener({ kind: "manuscript", projectId: "nope", path: "main.tex" })).rejects.toBeDefined();
    await expect(opener({ kind: "projectNote", projectId: "nope", path: "a.qmd" })).rejects.toBeDefined();
    expect(fake.opened).toEqual([]);
  });

  it("9.3b an unknown paper rejects without opening a LiveFile", async () => {
    const { fake, opener } = makeOpener({});
    await expect(opener({ kind: "paperNotes", paperId: "nope" })).rejects.toBeDefined();
    expect(fake.opened).toEqual([]);
  });

  it("9.3c ConsultIo lists library code files as library-relative paths of ready projects, filtered like codeLinkSource", async () => {
    const fs = memoryFs({
      "projects/thesis/labshelf.yaml": "id: thesis\nformat: latex\ntitle: Thesis\n",
      "projects/thesis/main.tex": "x",
      "projects/thesis/analysis.py": "print(1)",
      "projects/thesis/scripts/run.R": "1",
      "projects/thesis/README.md": "r",
      "projects/thesis/data.bin": "b",
    });
    const io = createBrowserConsultIo({ fs, logger, picked: createPickedFiles() } as never);
    const code = await io.listCodeFiles();
    expect(code).toEqual(expect.arrayContaining(["projects/thesis/analysis.py", "projects/thesis/scripts/run.R"]));
    expect(code).not.toContain("projects/thesis/main.tex");
    expect(code).not.toContain("projects/thesis/README.md");
    expect(code).not.toContain("projects/thesis/data.bin");
    expect(code).not.toContain("analysis.py");
  });

  it("9.3c paperIdsWithNotes lists only papers whose notes.qmd exists", async () => {
    papers.push(
      { id: "p1", title: "Smith", path: "papers/ml/smith" } as PaperRecord,
      { id: "p2", title: "Doe", path: "papers/ml/doe" } as PaperRecord,
    );
    const fs = memoryFs({ [createPaperFiles("papers/ml/smith", joinWith("/")).notes]: "# n", "papers/ml/doe/paper.pdf": "pdf" });
    const io = createBrowserConsultIo({ fs, logger, picked: createPickedFiles() } as never);
    expect(await io.paperIdsWithNotes()).toEqual(["p1"]);
  });

  it("9.3d without showOpenFilePicker, browse is undefined and canBrowse is false", async () => {
    (globalThis as { window?: unknown }).window = {};
    const io = createBrowserConsultIo({ fs: memoryFs({}), logger, picked: createPickedFiles() } as never);
    expect(io.browse).toBeUndefined();
    const reply = await answerConsult(io, {}, { kind: "list", what: "code" });
    expect(reply).toMatchObject({ ok: true, value: { kind: "entries", canBrowse: false } });
  });

  it("9.3d with showOpenFilePicker, browse is present, canBrowse is true and a picked file is a pickedFile entry", async () => {
    const handle = { name: "notes.txt", getFile: async () => ({ text: async () => "hi" }), createWritable: async () => ({ write: async () => undefined, close: async () => undefined }) };
    (globalThis as { window?: unknown }).window = { showOpenFilePicker: jest.fn(async () => [handle]) };
    const io = createBrowserConsultIo({ fs: memoryFs({}), logger, picked: createPickedFiles() } as never);
    expect(io.browse).toBeDefined();
    const list = await answerConsult(io, {}, { kind: "list", what: "code" });
    expect(list).toMatchObject({ ok: true, value: { kind: "entries", canBrowse: true } });
    const picked = await answerConsult(io, {}, { kind: "browse" });
    expect(picked).toMatchObject({ ok: true, value: { kind: "picked", entry: { label: "notes.txt", ref: { kind: "pickedFile", name: "notes.txt" } } } });
  });

  it("A10 a consult window and the editor tab of the same file share one hub replica", async () => {
    const { fake, opener } = makeOpener({ "projects/thesis/main.tex": "Shared" });
    // The editor tab's own open of the file, as openLiveBinding does it.
    const tab = fake.live.open("projects/thesis/main.tex");
    await tab.replica.ready;
    const file = await opener({ kind: "manuscript", projectId: "thesis", path: "main.tex" });
    if (file.kind !== "text" || !("collab" in file.binding)) { throw new Error("expected a collab text binding"); }
    expect(fake.opened).toEqual(["projects/thesis/main.tex", "projects/thesis/main.tex"]);
    expect(file.binding.collab.text.doc).toBe(tab.replica.doc);
    // An edit in the consult window is seen by the tab, and the replica stays open until both have released it.
    file.binding.collab.text.insert(6, "!");
    expect(tab.replica.text()).toBe("Shared!");
    file.release();
    await settle();
    expect(tab.replica.text()).toBe("Shared!");
    expect(tab.replica.doc.getText("content").toString()).toBe("Shared!");
    await tab.release();
  });

  it("A12 (Browse in Chrome and no Browse in Firefox are checked by hand) the same ConsultIo shows Browse only where showOpenFilePicker exists", async () => {
    const make = () => createBrowserConsultIo({ fs: memoryFs({}), logger, picked: createPickedFiles() } as never);
    (globalThis as { window?: unknown }).window = {};
    expect(make().browse).toBeUndefined();
    (globalThis as { window?: unknown }).window = { showOpenFilePicker: async () => [] };
    expect(make().browse).toBeDefined();
  });

  describe("10.3 createBrowserConsultSetup", () => {
    const libraryFiles = (): Record<string, string> => ({
      "projects/thesis/labshelf.yaml": "id: thesis\nformat: latex\ntitle: Thesis\n",
      "projects/thesis/main.tex": "x",
      "projects/thesis/notes/idea.qmd": "# Idea\n",
      "projects/other/labshelf.yaml": "id: other\nformat: latex\ntitle: Other\n",
      "projects/other/paper.tex": "y",
      "papers/ml/smith/notes.qmd": "# Notes\n",
    });
    const entriesOf = (reply: unknown): { ref: { kind: string; path?: string; projectId?: string }; group?: string }[] => {
      const value = (reply as { ok: boolean; value: { kind: string; entries?: never[] } }).value;
      return (value.entries ?? []) as never;
    };

    it("10.3a without projectId a list request has no project context: paper notes and every project's manuscripts, and openFile opens a paper's notes.qmd as a hub replica", async () => {
      papers.push({ id: "p1", title: "Smith", path: "papers/ml/smith" } as PaperRecord);
      const fake = fakeLive({ "papers/ml/smith/notes.qmd": "# Notes\n" });
      const setup = createBrowserConsultSetup({ fs: memoryFs(libraryFiles()), logger, live: fake.live });
      const notes = entriesOf(await setup.client({ kind: "list", what: "notes" }));
      expect(notes.map((entry) => entry.ref.kind)).toEqual(["paperNotes"]);
      const manuscripts = entriesOf(await setup.client({ kind: "list", what: "manuscript" }));
      expect(manuscripts.map((entry) => `${entry.ref.projectId}:${entry.ref.path}`)).toEqual(
        expect.arrayContaining(["thesis:main.tex", "other:paper.tex"]));
      const file = await setup.openFile({ kind: "paperNotes", paperId: "p1" });
      expect(fake.opened).toEqual(["papers/ml/smith/notes.qmd"]);
      expect(file.kind).toBe("qmd");
      file.release();
      await settle();
    });

    it("10.3b with projectId it reaches answerConsult: the project's notes join the notes list and its manuscripts come first", async () => {
      papers.push({ id: "p1", title: "Smith", path: "papers/ml/smith" } as PaperRecord);
      const fake = fakeLive({});
      const setup = createBrowserConsultSetup({ fs: memoryFs(libraryFiles()), logger, live: fake.live, projectId: "thesis" });
      const notes = entriesOf(await setup.client({ kind: "list", what: "notes" }));
      expect(notes.map((entry) => entry.ref.kind)).toEqual(["paperNotes", "projectNote"]);
      expect(notes[1]!.ref).toMatchObject({ projectId: "thesis", path: "notes/idea.qmd" });
      const manuscripts = entriesOf(await setup.client({ kind: "list", what: "manuscript" }));
      expect(manuscripts[0]!.ref.projectId).toBe("thesis");
    });
  });
});

describe("deriveConsultCodePath", () => {
  it("records a library code file relative to the editor's project folder, and nothing for a file picked outside the library", () => {
    expect(deriveConsultCodePath("Projects/thesis", { kind: "code", path: "Projects/thesis/analysis/fit.py" })).toBe("analysis/fit.py");
    expect(deriveConsultCodePath("Projects/thesis", { kind: "code", path: "Projects/model/run.py" })).toBe("../model/run.py");
    expect(deriveConsultCodePath("Projects/thesis", { kind: "pickedFile", id: "f1", name: "scratch.py" })).toBeUndefined();
  });
});
