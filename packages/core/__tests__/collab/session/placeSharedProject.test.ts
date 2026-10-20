/** Verifies that sharing a project seeds the comments map from comments.json and tolerates adapters that report a missing file as a plain Error. */
import * as Y from "yjs";
import { liveThreads } from "../../../src/collab/comments/index";
import { placeSharedProject } from "../../../src/collab/session/placeSharedProject";
import type { ShareSession } from "../../../src/collab/sync/index";
import type { ProjectCatalogContext } from "../../../src/writing/project/index";
import { fakeLogger } from "../sync/testSession";

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
  placeSharedProject({ context, libraryRoot: "/lib" }, SHARE_ID, { index } as unknown as ShareSession, { mode: "share", folder: FOLDER });

describe("placeSharedProject in share mode", () => {
  it("shares a project that has no comments.json", async () => {
    const { context, logger } = projectContext(new Map([[`${FOLDER}/labshelf.yaml`, "id: p\n"]]));
    const index = new Y.Doc();
    await expect(share(context, index)).resolves.toEqual({ folder: FOLDER, joinedId: undefined });
    expect(logger.error).not.toHaveBeenCalled();
    expect(liveThreads(index)).toEqual([]);
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
    expect(liveThreads(index).map((each) => each.id)).toEqual(["t1"]);
  });
});
