/** Verifies the library-wide conflict scan on project files: base seeding, three-way merges and copies left for the user. */
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { addExistingFolder, createProjectFromTemplate } from "../../../../src/writing/project/node/index";
import { blankTemplate } from "../../../../src/writing/templates/index";
import { FileMergeBaseStore, scanLibraryConflicts } from "../../../../src/writing/merge/node/index";
import type { IMergeBaseStore } from "../../../../src/writing/merge/index";
import type { ILogger } from "../../../../src/ports/index";
import { cleanupTempDirs, makeTempDir } from "../../../support/tempDirs";

afterEach(cleanupTempDirs);

const PARAGRAPHS = [
  "\\section{Introduction}\nDeep networks learn hierarchical features from raw data.\nWe study their robustness.",
  "Prior work measures robustness with adversarial examples~\\cite{goodfellow2015}.\nThese attacks are cheap to compute.",
  "\\section{Method}\nWe train a ResNet-50 on ImageNet with standard augmentation.\nThe learning rate follows a cosine schedule.",
  "Each model is evaluated under five corruption types.\nWe report the mean corruption error.",
  "\\section{Results}\nRobust training lowers the corruption error by 12\\%.\nClean accuracy drops by one point.",
  "\\section{Conclusion}\nRobustness and accuracy trade off mildly.\nFuture work studies larger models.",
];
const SYNCTHING_COPY = "main.sync-conflict-20240301-123456-ABCDEFG.tex";

function doc(paragraphs: readonly string[], eol = "\n"): string {
  return `${paragraphs.join("\n\n")}\n`.replace(/\n/g, eol);
}

function edit(index: number, text: string): string[] {
  return PARAGRAPHS.map((paragraph, i) => i === index ? text : paragraph);
}

interface RecordedLog { level: string; message: string; context: Record<string, unknown> | undefined }

function recordingLogger(): ILogger & { logs: RecordedLog[]; errors: Array<Record<string, unknown> | undefined> } {
  const logs: RecordedLog[] = [];
  const errors: Array<Record<string, unknown> | undefined> = [];
  return {
    logs,
    errors,
    log: async (level, _module, message, context) => { logs.push({ level, message, context }); },
    error: async (_module, _error, context) => { errors.push(context); },
  };
}

function memoryStore(): IMergeBaseStore & { bases: Map<string, string> } {
  const bases = new Map<string, string>();
  return {
    bases,
    read: async (projectId, relativePath) => bases.get(`${projectId}/${relativePath}`),
    write: async (projectId, relativePath, text) => { bases.set(`${projectId}/${relativePath}`, text); },
  };
}

/** A library with one project projects/<id>/ whose main.tex holds the base document; the base is seeded by a first scan. */
async function libraryProject(seed = true) {
  const lib = await makeTempDir();
  const logger = recordingLogger();
  const entry = await createProjectFromTemplate(lib, { title: "Robust Nets", ...blankTemplate("latex", "Robust Nets") }, logger);
  const folder = entry.folder;
  const id = entry.kind === "ready" ? entry.settings.id : "";
  await fs.writeFile(path.join(folder, "main.tex"), doc(PARAGRAPHS));
  const store = memoryStore();
  if (seed) { expect(await scanLibraryConflicts(lib, store, logger)).toEqual([]); }
  return { lib, folder, id, store, logger };
}

describe("scanLibraryConflicts on project files", () => {
  it("merges edits to different paragraphs, deletes the copy and stores the copy as the base", async () => {
    const { lib, folder, id, store, logger } = await libraryProject();
    const local = edit(0, "\\section{Introduction}\nDeep networks learn features.\nWe study their robustness.");
    const other = edit(4, "\\section{Results}\nRobust training lowers the corruption error by 15\\%.\nClean accuracy drops by one point.");
    await fs.writeFile(path.join(folder, "main.tex"), doc(local));
    await fs.writeFile(path.join(folder, SYNCTHING_COPY), doc(other));

    expect(await scanLibraryConflicts(lib, store, logger)).toEqual([]);
    const merged = await fs.readFile(path.join(folder, "main.tex"), "utf8");
    expect(merged).toBe(doc([local[0]!, ...PARAGRAPHS.slice(1, 4), other[4]!, PARAGRAPHS[5]!]));
    expect(merged).not.toContain("<<<<<<<");
    await expect(fs.stat(path.join(folder, SYNCTHING_COPY))).rejects.toThrow();
    expect(await store.read(id, "main.tex")).toBe(doc(other));
  });

  it("keeps the local edit when the other device edits again before it receives the merge", async () => {
    const { lib, folder, store, logger } = await libraryProject();
    const local = edit(0, "\\section{Introduction}\nDeep networks learn features.\nWe study their robustness.");
    const other = edit(4, "\\section{Results}\nRobust training lowers the corruption error by 15\\%.\nClean accuracy drops by one point.");
    await fs.writeFile(path.join(folder, "main.tex"), doc(local));
    await fs.writeFile(path.join(folder, SYNCTHING_COPY), doc(other));
    await scanLibraryConflicts(lib, store, logger);

    const otherAgain = other.map((paragraph, i) => i === 2 ? `${paragraph}\nWe also try a ViT-B/16.` : paragraph);
    await fs.writeFile(path.join(folder, SYNCTHING_COPY), doc(otherAgain));
    await scanLibraryConflicts(lib, store, logger);

    const merged = await fs.readFile(path.join(folder, "main.tex"), "utf8");
    expect(merged).toBe(doc([local[0]!, PARAGRAPHS[1]!, otherAgain[2]!, PARAGRAPHS[3]!, other[4]!, PARAGRAPHS[5]!]));
  });

  it("merges two copies of one file without dropping any side's edit", async () => {
    const { lib, folder, id, store, logger } = await libraryProject();
    const local = edit(0, "\\section{Introduction}\nDeep networks learn features.\nWe study their robustness.");
    const second = "main.sync-conflict-20240302-090000-HIJKLMN.tex";
    await fs.writeFile(path.join(folder, "main.tex"), doc(local));
    await fs.writeFile(path.join(folder, SYNCTHING_COPY), doc(edit(2, "\\section{Method}\nWe train a ViT.\nThe learning rate follows a cosine schedule.")));
    await fs.writeFile(path.join(folder, second), doc(edit(4, "\\section{Results}\nRobust training helps.\nClean accuracy drops by one point.")));

    expect(await scanLibraryConflicts(lib, store, logger)).toEqual([]);
    const merged = await fs.readFile(path.join(folder, "main.tex"), "utf8");
    expect(merged).toContain("Deep networks learn features.");
    expect(merged).toContain("We train a ViT.");
    expect(merged).toContain("Robust training helps.");
    expect(merged).not.toContain("<<<<<<<");
    await expect(fs.stat(path.join(folder, second))).rejects.toThrow();
    expect(await store.read(id, "main.tex")).toBe(doc(PARAGRAPHS));
  });

  it("seeds no base inside node_modules", async () => {
    const { lib, folder, id, store, logger } = await libraryProject();
    await fs.mkdir(path.join(folder, "node_modules", "pkg"), { recursive: true });
    await fs.writeFile(path.join(folder, "node_modules", "pkg", "README.md"), "# pkg\n");
    await scanLibraryConflicts(lib, store, logger);
    expect(await store.read(id, "node_modules/pkg/README.md")).toBeUndefined();
  });

  it("marks the same line edited on both sides, deletes the copy and logs the path as conflicted", async () => {
    const { lib, folder, logger, store } = await libraryProject();
    const mine = "\\section{Method}\nWe train a ViT-B/16 on ImageNet with standard augmentation.\nThe learning rate follows a cosine schedule.";
    const theirs = "\\section{Method}\nWe train a ResNet-101 on ImageNet with standard augmentation.\nThe learning rate follows a cosine schedule.";
    await fs.writeFile(path.join(folder, "main.tex"), doc(edit(2, mine)));
    await fs.writeFile(path.join(folder, SYNCTHING_COPY), doc(edit(2, theirs)));

    expect(await scanLibraryConflicts(lib, store, logger)).toEqual([]);
    const merged = await fs.readFile(path.join(folder, "main.tex"), "utf8");
    expect(merged).toMatch(/<<<<<<< local\nWe train a ViT-B\/16[^\n]*\n=======\nWe train a ResNet-101[^\n]*\n>>>>>>> syncthing\n/);
    await expect(fs.stat(path.join(folder, SYNCTHING_COPY))).rejects.toThrow();
    expect(logger.logs.some((log) => log.context?.path === "main.tex" && log.context?.conflicted === true)).toBe(true);
  });

  it("keeps a copy whose original has no base and returns it as a project conflict", async () => {
    const { lib, folder, id, store, logger } = await libraryProject(false);
    const copy = path.join(folder, SYNCTHING_COPY);
    await fs.writeFile(copy, doc(edit(1, "Changed.")));
    expect(await scanLibraryConflicts(lib, store, logger)).toEqual([
      { owner: { kind: "project", id }, original: path.join(folder, "main.tex"), copy, tool: "syncthing" },
    ]);
    expect(await fs.readFile(copy, "utf8")).toBe(doc(edit(1, "Changed.")));
    expect(await store.read(id, "main.tex")).toBeUndefined();
  });

  it("keeps a conflict copy of a binary file for the user", async () => {
    const { lib, folder, id, store, logger } = await libraryProject();
    await fs.writeFile(path.join(folder, "figure.pdf"), "%PDF-1.7 mine");
    const copy = path.join(folder, "figure (conflicted copy 2024-01-02 101010).pdf");
    await fs.writeFile(copy, "%PDF-1.7 theirs");
    expect(await scanLibraryConflicts(lib, store, logger)).toEqual([
      { owner: { kind: "project", id }, original: path.join(folder, "figure.pdf"), copy, tool: "nextcloud" },
    ]);
    expect(await store.read(id, "figure.pdf")).toBeUndefined();
  });

  it("keeps the copy and the original and logs an error when the merged file cannot be written", async () => {
    const { lib, folder, store, logger } = await libraryProject();
    const local = doc(edit(0, "Local intro."));
    await fs.writeFile(path.join(folder, "main.tex"), local);
    await fs.writeFile(path.join(folder, SYNCTHING_COPY), doc(edit(4, "Other results.")));
    await fs.chmod(folder, 0o555);
    try {
      const unresolved = await scanLibraryConflicts(lib, store, logger);
      expect(unresolved.map((c) => path.basename(c.copy))).toEqual([SYNCTHING_COPY]);
    } finally {
      await fs.chmod(folder, 0o755);
    }
    expect(await fs.readFile(path.join(folder, "main.tex"), "utf8")).toBe(local);
    expect(logger.errors.some((context) => context?.path === "main.tex")).toBe(true);
  });

  it("keeps CRLF line endings of the local file", async () => {
    const { lib, folder, store, logger } = await libraryProject();
    await fs.writeFile(path.join(folder, "main.tex"), doc(edit(0, "Local intro."), "\r\n"));
    await fs.writeFile(path.join(folder, SYNCTHING_COPY), doc(edit(5, "Other conclusion.")));
    await scanLibraryConflicts(lib, store, logger);
    const merged = await fs.readFile(path.join(folder, "main.tex"), "utf8");
    expect(merged).toBe(doc(["Local intro.", ...PARAGRAPHS.slice(1, 5), "Other conclusion."], "\r\n"));
  });

  it("seeds bases for text files only and never overwrites one on a later scan", async () => {
    const { lib, folder, id, store, logger } = await libraryProject(false);
    await fs.mkdir(path.join(folder, "sections"));
    await fs.writeFile(path.join(folder, "sections", "intro.tex"), "\\section{Intro}\nText.\n");
    await fs.writeFile(path.join(folder, "figure.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe]));
    await fs.writeFile(path.join(folder, "bad.txt"), Buffer.from([0xff, 0xfe, 0xfd]));
    await scanLibraryConflicts(lib, store, logger);
    expect(await store.read(id, "main.tex")).toBe(doc(PARAGRAPHS));
    expect(await store.read(id, "sections/intro.tex")).toBe("\\section{Intro}\nText.\n");
    expect(await store.read(id, "figure.png")).toBeUndefined();
    expect(await store.read(id, "bad.txt")).toBeUndefined();

    await fs.writeFile(path.join(folder, "main.tex"), doc(edit(0, "Own edit.")));
    await scanLibraryConflicts(lib, store, logger);
    expect(await store.read(id, "main.tex")).toBe(doc(PARAGRAPHS));
  });

  it("covers a registered external project folder with the on-disk base store", async () => {
    const lib = await makeTempDir();
    const state = await makeTempDir();
    const folder = path.join(await makeTempDir(), "thesis");
    await fs.mkdir(folder);
    await fs.writeFile(path.join(folder, "main.tex"), doc(PARAGRAPHS));
    const logger = recordingLogger();
    await addExistingFolder(lib, { folder, format: "latex" }, logger);
    const store = new FileMergeBaseStore(lib, { XDG_STATE_HOME: state, XDG_CACHE_HOME: state });
    await scanLibraryConflicts(lib, store, logger);

    await fs.writeFile(path.join(folder, "main.tex"), doc(edit(0, "Local intro.")));
    await fs.writeFile(path.join(folder, SYNCTHING_COPY), doc(edit(5, "Other conclusion.")));
    expect(await scanLibraryConflicts(lib, store, logger)).toEqual([]);
    expect(await fs.readFile(path.join(folder, "main.tex"), "utf8"))
      .toBe(doc(["Local intro.", ...PARAGRAPHS.slice(1, 5), "Other conclusion."]));
  });

  it("returns paper conflicts with a paper owner alongside project ones", async () => {
    const { lib, store, logger } = await libraryProject();
    const paper = path.join(lib, "papers", "ml", "smith2020x");
    await fs.mkdir(paper, { recursive: true });
    await fs.writeFile(path.join(paper, "metadata.yaml"), "title: x\n");
    await fs.writeFile(path.join(paper, "paper.sync-conflict-20240301-123456-ABCDEFG.pdf"), "pdf");
    const copies = await scanLibraryConflicts(lib, store, logger);
    expect(copies.map((c) => c.owner)).toEqual([{ kind: "paper", id: "smith2020x" }]);
  });
});
