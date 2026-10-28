/** Pins that a shared project keeps its comments as a Y.Map of threads and that its disk side is .labshelf/comments.qmd, never a text doc. */
import * as Y from "yjs";
import {
  addLiveThread,
  addLiveThreadReply,
  COMMENTS_PATH,
  deriveSharedFileKind,
  deriveSharedPaths,
  importCommentsFile,
  readLiveThreads,
  readShareIndexDocFiles,
  type CommentThread,
  type ShareSession,
} from "../../../src/collab/index";
import { parseCommentsQmd, serializeCommentsQmd } from "../../../src/collab/commentsQmd";
import { ensureSharedProject } from "../../../src/collab/session/index";
import type { ProjectCatalogContext } from "../../../src/writing/project/index";
import { fakeLogger } from "../testSession";
import { memoryFiles, nodeFiles } from "./mirrorFiles";
import { exists, openMirror, readFile, writeFile, type MirrorFixture } from "./mirrorFixture";

const QMD = ".labshelf/comments.qmd";
const JSON_FILE = ".labshelf/comments.json";

const thread: CommentThread = {
  id: "t1", file: "main.typ", anchor: { quote: "hello", prefix: "say ", suffix: " world" }, resolved: false,
  comments: [{ id: "c1", author: "Ada", body: "Why is $x^2$ here?", createdAt: "2026-10-20T10:00:00.000Z" }],
};

const threadIds = (text: string): string[] =>
  (parseCommentsQmd(text)!.threads as { id: string }[]).map((each) => each.id);

describe.each([nodeFiles, memoryFiles()])("8.3a comments.qmd in a mirror over a $name", (files) => {
  let fixture: MirrorFixture;
  afterEach(async () => { await fixture.close(); });

  it("8.3a writes a remote thread added to the Y.Map to comments.qmd", async () => {
    fixture = await openMirror({ files });
    await fixture.mirror.idle();
    expect(COMMENTS_PATH).toBe(QMD);
    expect(fixture.diskChanges).not.toContain(QMD);

    addLiveThread(fixture.session.index, thread);
    await fixture.mirror.idle();
    const written = await readFile(fixture, QMD);
    expect(parseCommentsQmd(written)).toBeDefined();
    expect(threadIds(written)).toEqual(["t1"]);
    expect(written).toContain("Why is $x^2$ here?");
  });

  it("8.3a writes a reply added to the Y.Map to comments.qmd", async () => {
    fixture = await openMirror({ files });
    addLiveThread(fixture.session.index, thread);
    await fixture.mirror.idle();
    addLiveThreadReply(fixture.session.index, "t1", { id: "c2", author: "Grace", body: "Because.", createdAt: "2026-10-20T10:01:00.000Z" });
    await fixture.mirror.idle();
    expect(await readFile(fixture, QMD)).toContain("Because.");
  });

  it("8.3a writes no comments.json", async () => {
    fixture = await openMirror({ files });
    addLiveThread(fixture.session.index, thread);
    await fixture.mirror.idle();
    expect(await exists(fixture, QMD)).toBe(true);
    expect(await exists(fixture, JSON_FILE)).toBe(false);
    expect(fixture.diskChanges).not.toContain(JSON_FILE);
  });

  it("8.3a writes no comments.qmd into a project while the map is empty", async () => {
    fixture = await openMirror({ files });
    await fixture.mirror.idle();
    expect(await exists(fixture, QMD)).toBe(false);
  });

  it("8.3a keeps a comments.qmd that is not readable and warns about comments.qmd", async () => {
    fixture = await openMirror({ files });
    const conflicted = "<<<<<<< ours\none\n=======\ntwo\n>>>>>>> theirs\n";
    await writeFile(fixture, QMD, conflicted);
    addLiveThread(fixture.session.index, thread);
    await fixture.mirror.idle();
    expect(await readFile(fixture, QMD)).toBe(conflicted);
    expect(fixture.logger.log.mock.calls.some(([level, , message]) => level === "WARN" && /comments\.qmd/.test(message))).toBe(true);
  });
});

describe("8.3b comments.qmd on disk to the Y.Map", () => {
  const file = serializeCommentsQmd({ threads: [thread] });

  it("8.3b importCommentsFile adds the threads of a comments.qmd text to the map", () => {
    const doc = new Y.Doc();
    expect(importCommentsFile(doc, file)).toBe(1);
    expect(readLiveThreads(doc).map((each) => each.id)).toEqual(["t1"]);
  });

  it("8.3b keeps the body of a comment as its LabShelf Markdown string", () => {
    const doc = new Y.Doc();
    importCommentsFile(doc, file);
    expect(readLiveThreads(doc)[0]!.comments[0]!.body).toBe("Why is $x^2$ here?");
    expect(readLiveThreads(doc)[0]!.anchor).toEqual(thread.anchor);
  });

  it("8.3b adds only the threads the map does not hold", () => {
    const doc = new Y.Doc();
    addLiveThread(doc, thread);
    expect(importCommentsFile(doc, file)).toBe(0);
    const edited = serializeCommentsQmd({ threads: [thread, { ...thread, id: "t2", comments: [{ ...thread.comments[0]!, id: "c9" }] }] });
    expect(importCommentsFile(doc, edited)).toBe(1);
    expect(readLiveThreads(doc).map((each) => each.id).sort()).toEqual(["t1", "t2"]);
  });

  it("8.3b reads a comments.qmd with a reply as one thread of two comments", () => {
    const doc = new Y.Doc();
    const replied = serializeCommentsQmd({
      threads: [{ ...thread, comments: [...thread.comments, { id: "c2", author: "Grace", body: "Because.", createdAt: "2026-10-20T10:01:00.000Z" }] }],
    });
    importCommentsFile(doc, replied);
    expect(readLiveThreads(doc)[0]!.comments.map((each) => each.id)).toEqual(["c1", "c2"]);
  });

  it("8.3b reports a comments.qmd that is not readable as undefined and adds nothing", () => {
    const doc = new Y.Doc();
    expect(importCommentsFile(doc, "<<<<<<< ours\none\n=======\ntwo\n>>>>>>> theirs\n")).toBeUndefined();
    expect(readLiveThreads(doc)).toEqual([]);
  });
});

describe("8.3b sharing a project seeds the map from comments.qmd", () => {
  const FOLDER = "/lib/p";
  const SHARE_ID = "f".repeat(32);

  function projectContext(files: Map<string, string>) {
    const logger = fakeLogger();
    const context = {
      logger,
      paths: { join: (...parts: string[]) => parts.join("/") },
      fs: {
        exists: async (path: string) => files.has(path),
        readText: async (path: string) => {
          const text = files.get(path);
          if (text === undefined) { throw new Error(`File not found: ${path}`); }
          return text;
        },
        writeText: async (path: string, text: string) => { files.set(path, text); },
      },
    } as unknown as ProjectCatalogContext;
    return { context, logger };
  }

  const share = (context: ProjectCatalogContext, index: Y.Doc) =>
    ensureSharedProject({ context, libraryRoot: "/lib" }, SHARE_ID, { index } as unknown as ShareSession, { mode: "share", folder: FOLDER });

  it("8.3b imports the threads of comments.qmd into the session", async () => {
    const { context } = projectContext(new Map([
      [`${FOLDER}/labshelf.yaml`, "id: p\n"],
      [`${FOLDER}/${QMD}`, serializeCommentsQmd({ threads: [thread] })],
    ]));
    const index = new Y.Doc();
    await share(context, index);
    expect(readLiveThreads(index).map((each) => each.id)).toEqual(["t1"]);
  });

  it("8.3b does not read comments.json", async () => {
    const { context } = projectContext(new Map([
      [`${FOLDER}/labshelf.yaml`, "id: p\n"],
      [`${FOLDER}/${JSON_FILE}`, JSON.stringify({ threads: [thread] })],
    ]));
    const index = new Y.Doc();
    await share(context, index);
    expect(readLiveThreads(index)).toEqual([]);
  });

  it("8.3b warns about comments.qmd when it is not readable", async () => {
    const { context, logger } = projectContext(new Map([
      [`${FOLDER}/labshelf.yaml`, "id: p\n"],
      [`${FOLDER}/${QMD}`, "<<<<<<< ours\none\n=======\ntwo\n>>>>>>> theirs\n"],
    ]));
    const index = new Y.Doc();
    await share(context, index);
    expect(readLiveThreads(index)).toEqual([]);
    expect(logger.log.mock.calls.some(([level, , message]) => level === "WARN" && /comments\.qmd/.test(message))).toBe(true);
  });
});

describe("8.3c comments.qmd is not a text doc", () => {
  const bytes = new TextEncoder().encode("Some valid UTF-8 text.\n");

  it("8.3c derives a blob, not text, for .labshelf/comments.qmd", () => {
    expect(deriveSharedFileKind(QMD, bytes)).toBe("blob");
  });

  it("8.3c still derives text for a .qmd note elsewhere", () => {
    expect(deriveSharedFileKind("notes/ideas.qmd", bytes)).toBe("text");
    expect(deriveSharedFileKind("comments.qmd", bytes)).toBe("text");
  });

  it("8.3c does not list .labshelf/comments.qmd among the shared paths", () => {
    expect(deriveSharedPaths(["main.typ", QMD, "notes.qmd"])).not.toContain(QMD);
  });

  it("8.3c gives a mirror that finds comments.qmd on disk no text doc for it", async () => {
    const fixture = await openMirror({ files: nodeFiles });
    try {
      await writeFile(fixture, QMD, serializeCommentsQmd({ threads: [thread] }));
      fixture.mirror.changed(QMD);
      await fixture.mirror.idle();
      expect(readShareIndexDocFiles(fixture.session.index).get(QMD)).toBeUndefined();
    } finally {
      await fixture.close();
    }
  });
});
