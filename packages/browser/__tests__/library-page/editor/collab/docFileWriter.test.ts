// The disk mirror of a joined project: debounced writes per file, a retry after a failed write, and refused unsafe paths.
import * as Y from "yjs";
import { COMMENTS_PATH, fileText, indexFiles, type ILogger, type LibraryFileSystem } from "@labshelf/core";
import { startDocFileWriter, type DocFileWriter } from "../../../../src/library-page/editor/collab";
import { memoryLibraryFs } from "../../../support/memoryLibraryFs";

const FOLDER = "projects/draft";
let logger: ILogger;
let fs: LibraryFileSystem;
let writes: string[];
let index: Y.Doc;
let docs: Map<string, Y.Doc>;
let writer: DocFileWriter | undefined;

const session = () => ({ index, openDoc: (path: string) => { if (!docs.has(path)) docs.set(path, new Y.Doc()); return docs.get(path)!; } });
const logged = (text: string): boolean =>
  [...(logger.log as jest.Mock).mock.calls, ...(logger.error as jest.Mock).mock.calls].some((call) => JSON.stringify(call).includes(text));

beforeEach(() => {
  jest.useFakeTimers();
  logger = { log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) };
  const memory = memoryLibraryFs();
  writes = [];
  fs = { ...memory, writeText: async (path, text) => { writes.push(path); await memory.writeText(path, text); } };
  index = new Y.Doc();
  docs = new Map();
});
afterEach(async () => { await writer?.close(); writer = undefined; jest.useRealTimers(); });

describe("startDocFileWriter", () => {
  it("writes a file once, 500 ms after its last change", async () => {
    indexFiles(index).set("main.tex", { kind: "text" });
    writer = startDocFileWriter({ session: session(), fs, folder: FOLDER, logger });
    const text = fileText(docs.get("main.tex")!);
    text.insert(0, "a");
    await jest.advanceTimersByTimeAsync(300);
    text.insert(1, "b");
    await jest.advanceTimersByTimeAsync(499);
    expect(writes.filter((path) => path.endsWith("main.tex"))).toEqual([]);
    await jest.advanceTimersByTimeAsync(1);
    expect(writes.filter((path) => path.endsWith("main.tex"))).toEqual([`${FOLDER}/main.tex`]);
    expect(await fs.readText(`${FOLDER}/main.tex`)).toBe("ab");
  });

  it("writes a file listed after the writer started", async () => {
    writer = startDocFileWriter({ session: session(), fs, folder: FOLDER, logger });
    indexFiles(index).set("sections/intro.tex", { kind: "text" });
    fileText(docs.get("sections/intro.tex")!).insert(0, "intro");
    await jest.advanceTimersByTimeAsync(500);
    expect(await fs.readText(`${FOLDER}/sections/intro.tex`)).toBe("intro");
  });

  it("logs a failed write and retries it on the next change", async () => {
    let failures = 1;
    const write = fs.writeText;
    fs.writeText = async (path, text) => { if (path.endsWith("main.tex") && failures-- > 0) throw new Error("disk full"); await write(path, text); };
    indexFiles(index).set("main.tex", { kind: "text" });
    writer = startDocFileWriter({ session: session(), fs, folder: FOLDER, logger });
    fileText(docs.get("main.tex")!).insert(0, "a");
    await jest.advanceTimersByTimeAsync(500);
    expect(await fs.exists(`${FOLDER}/main.tex`)).toBe(false);
    expect(logger.error).toHaveBeenCalledWith(expect.any(String), expect.any(Error), expect.objectContaining({ path: `${FOLDER}/main.tex` }));
    fileText(docs.get("main.tex")!).insert(1, "b");
    await jest.advanceTimersByTimeAsync(500);
    expect(await fs.readText(`${FOLDER}/main.tex`)).toBe("ab");
  });

  it("retries a failed file when another file changes", async () => {
    let failures = 1;
    const write = fs.writeText;
    fs.writeText = async (path, text) => { if (path.endsWith("a.tex") && failures-- > 0) throw new Error("busy"); await write(path, text); };
    indexFiles(index).set("a.tex", { kind: "text" });
    indexFiles(index).set("b.tex", { kind: "text" });
    writer = startDocFileWriter({ session: session(), fs, folder: FOLDER, logger });
    fileText(docs.get("a.tex")!).insert(0, "a");
    await jest.advanceTimersByTimeAsync(500);
    fileText(docs.get("b.tex")!).insert(0, "b");
    await jest.advanceTimersByTimeAsync(500);
    expect(await fs.readText(`${FOLDER}/a.tex`)).toBe("a");
  });

  it("refuses paths that leave the project folder", async () => {
    indexFiles(index).set("../escape.tex", { kind: "text" });
    indexFiles(index).set("/etc/passwd", { kind: "text" });
    writer = startDocFileWriter({ session: session(), fs, folder: FOLDER, logger });
    await jest.advanceTimersByTimeAsync(1000);
    expect(docs.size).toBe(0);
    expect(writes.filter((path) => path.includes("escape") || path.includes("passwd"))).toEqual([]);
    expect(logged("../escape.tex")).toBe(true);
  });

  it("skips blobs with a log line", async () => {
    indexFiles(index).set("figure.png", { kind: "blob", hash: "0".repeat(64) });
    writer = startDocFileWriter({ session: session(), fs, folder: FOLDER, logger });
    await jest.advanceTimersByTimeAsync(1000);
    expect(writes.filter((path) => path.endsWith("figure.png"))).toEqual([]);
    expect(logged("figure.png")).toBe(true);
  });

  it("does not overwrite a comments file that does not parse", async () => {
    await fs.writeText(`${FOLDER}/${COMMENTS_PATH}`, "{ broken");
    writes = [];
    writer = startDocFileWriter({ session: session(), fs, folder: FOLDER, logger });
    index.getMap("other").set("x", 1);
    await jest.advanceTimersByTimeAsync(500);
    expect(await fs.readText(`${FOLDER}/${COMMENTS_PATH}`)).toBe("{ broken");
    expect(logged(COMMENTS_PATH)).toBe(true);
  });
});
