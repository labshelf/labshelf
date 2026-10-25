/** Verifies that sharing a project seeds the comments map from comments.json and tolerates adapters that report a missing file as a plain Error. */
import * as Y from "yjs";
import { readLiveThreads } from "../../../src/collab/comments/index";
import { ensureSharedProject } from "../../../src/collab/session/ensureSharedProject";
import type { ShareSession } from "../../../src/collab/doc/shareSession";
import type { ProjectCatalogContext } from "../../../src/writing/project/index";
import { fakeLogger } from "../doc/testSession";

const FOLDER = "/lib/p";
const SHARE_ID = "f".repeat(32);

/** An in-memory file system whose missing-file error carries no `code`, like the browser adapters. */
function projectContext(files: Map<string, string>) {
  const logger = fakeLogger();
  const context = {
    logger,
    paths: { join: (...parts: string[]) => parts.join("/") },
    fs: {
      exists: async (file: string) => files.has(file),
      readText: async (file: string) => {
        const text = files.get(file);
        if (text === undefined) { throw new Error(`File not found: ${file}`); }
        return text;
      },
      writeText: async (file: string, text: string) => { files.set(file, text); },
    },
  } as unknown as ProjectCatalogContext;
  return { context, logger };
}

const share = (context: ProjectCatalogContext, index: Y.Doc) =>
  ensureSharedProject({ context, libraryRoot: "/lib" }, SHARE_ID, { index } as unknown as ShareSession, { mode: "share", folder: FOLDER });

describe("ensureSharedProject in share mode", () => {
  it("shares a project that has no comments.json", async () => {
    const { context, logger } = projectContext(new Map([[`${FOLDER}/labshelf.yaml`, "id: p\n"]]));
    const index = new Y.Doc();
    await expect(share(context, index)).resolves.toEqual({ folder: FOLDER, joinedId: undefined });
    expect(logger.error).not.toHaveBeenCalled();
    expect(readLiveThreads(index)).toEqual([]);
  });

  it("imports the threads of comments.json into the session", async () => {
    const thread = {
      id: "t1", file: "main.tex", anchor: { quote: "q", prefix: "a", suffix: "b" },
      comments: [{ id: "c1", author: "Ana", body: "x", createdAt: "2026-10-16T09:00:00.000Z" }], resolved: false,
    };
    const { context } = projectContext(new Map([
      [`${FOLDER}/labshelf.yaml`, "id: p\n"],
      [`${FOLDER}/.labshelf/comments.json`, JSON.stringify({ threads: [thread] })],
    ]));
    const index = new Y.Doc();
    await share(context, index);
    expect(readLiveThreads(index).map((each) => each.id)).toEqual(["t1"]);
  });
});
