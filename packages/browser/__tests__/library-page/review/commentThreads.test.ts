/** Verifies the page's comment store persists add, reply and resolve in comments.json and leaves an invalid file untouched. */
import type { IFileSystem, LibraryFileSystem, ProjectEntry } from "@labshelf/core";
import { createCommentThreads } from "../../../src/library-page/review";

function writableFs(files: Record<string, string>): LibraryFileSystem {
  const dirs = new Set<string>();
  const fake: IFileSystem = {
    exists: async (target) => target in files || dirs.has(target),
    readText: async (target) => files[target]!,
    writeText: async (target, text) => { files[target] = text; },
    ensureDir: async (dir) => { dirs.add(dir); },
  };
  return fake as LibraryFileSystem;
}

const entry = { kind: "ready", folder: "/lib/p", settings: { id: "p", title: "P", format: "latex" }, main: "main.tex" } as unknown as ProjectEntry;
const logger = { log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) } as never;
const SOURCE = "Intro\nWe use a strong baseline here.\n";
const range = { start: SOURCE.indexOf("baseline"), end: SOURCE.indexOf("baseline") + 8 };

function setup(extra: Record<string, string> = {}) {
  const files: Record<string, string> = { "/lib/p/main.tex": SOURCE, ...extra };
  const store = createCommentThreads({ fs: writableFs(files), session: { current: () => entry }, logger });
  return { files, store };
}

describe("comment threads", () => {
  it("persists an added comment, a reply and a resolve in comments.json", async () => {
    const { files, store } = setup();
    await store.addComment("p", "main.tex", range, "Which baseline?");
    const [added] = await store.threads("p", "main.tex");
    expect(added).toMatchObject({ file: "main.tex", line: 2, resolved: false, anchor: { quote: "baseline" } });
    await store.reply(added!.id, "The first one.");
    await store.resolve(added!.id);
    const [saved] = await store.threads("p");
    expect(saved!.comments.map((each) => each.body)).toEqual(["Which baseline?", "The first one."]);
    expect(saved!.resolved).toBe(true);
    expect(JSON.parse(files["/lib/p/.labshelf/comments.json"]!).threads).toHaveLength(1);
  });

  it("tells subscribers the ranges of open threads after each change", async () => {
    const { store } = setup();
    const seen: unknown[] = [];
    const stop = store.commentAnchorsFor("p", "main.tex").subscribe((ranges) => seen.push(ranges));
    await store.addComment("p", "main.tex", range, "Which?");
    await new Promise((resolve) => setTimeout(resolve, 0));
    const [thread] = await store.threads("p");
    await store.resolve(thread!.id);
    await new Promise((resolve) => setTimeout(resolve, 0));
    stop();
    expect(seen).toEqual([[], [range], []]);
  });

  it("reports a thread whose text is gone as having no line", async () => {
    const { files, store } = setup();
    await store.addComment("p", "main.tex", range, "Which?");
    files["/lib/p/main.tex"] = "Completely different.\n";
    expect((await store.threads("p"))[0]!.line).toBeUndefined();
  });

  it("leaves an invalid comments.json as it is and refuses to read or write it", async () => {
    const { files, store } = setup({ "/lib/p/.labshelf/comments.json": "<<<<<<< ours\n" });
    await expect(store.threads("p")).rejects.toThrow(/Fix the file/);
    await expect(store.addComment("p", "main.tex", range, "x")).rejects.toThrow(/left as it is/);
    expect(files["/lib/p/.labshelf/comments.json"]).toBe("<<<<<<< ours\n");
  });

  it("rejects a project that is not the open one", async () => {
    const { store } = setup();
    await expect(store.threads("other")).rejects.toThrow(/not the open project/);
  });
});
