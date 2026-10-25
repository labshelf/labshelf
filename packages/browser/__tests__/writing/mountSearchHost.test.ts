// The search host posts the project scope, labels matches by relative path, opens only searched files and rewrites matches on replaceFile.
import type { HostToSearch, ILogger, SearchToHost } from "@labshelf/core";
import { createLoopbackTransport } from "@labshelf/core";
import { mountSearchHost } from "../../src/writing/mountSearchHost";
import { clearFakeDb } from "../support/fakeIdb";
import { memoryLibraryFs } from "../support/memoryLibraryFs";

jest.mock("@labshelf/core/dom", () => ({ toast: jest.fn(), confirmDialog: jest.fn(), inputBox: jest.fn() }));
jest.mock("../../src/storage/idbDatabase", () => ({ getDb: async () => require("../support/fakeIdb").fakeDb }));

const logger: ILogger = { log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) } as unknown as ILogger;
const project = { id: "thesis", folder: "proj" };
const options = { matchCase: false, wholeWord: false, regex: false };
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const settle = async (): Promise<void> => { await wait(250); };

async function setup() {
  const fs = memoryLibraryFs();
  await fs.writeText("proj/main.typ", "cat and cat\nno match\ncat");
  await fs.writeText("proj/chapters/two.tex", "a cat\r\nb");
  await fs.writeText("proj/image.png", "cat");
  const { ui, host } = createLoopbackTransport<SearchToHost, HostToSearch>();
  const received: HostToSearch[] = [];
  ui.subscribe((message) => received.push(message));
  const openMatch = jest.fn();
  mountSearchHost({ fs, logger, endpoint: host, project, openMatch });
  const results = () => received.filter((m): m is Extract<HostToSearch, { type: "results" }> => m.type === "results");
  const search = async (query = "cat") => { ui.post({ type: "search", query, options, scope: "project" }); await settle(); };
  return { fs, ui, received, results, search, openMatch };
}

beforeEach(() => { clearFakeDb(); jest.clearAllMocks(); });

describe("mountSearchHost", () => {
  it("posts the project scope without an active file on ready", async () => {
    const { ui, received } = await setup();
    ui.post({ type: "ready" });
    await settle();
    expect(received).toEqual([{ type: "scope", scope: { project: "thesis", folder: "proj", file: null } }]);
  });

  it("labels matches by the path relative to the project and skips unsearchable files", async () => {
    const { results, search } = await setup();
    await search();
    const found = results()[0]!.results;
    expect(found.files.map((file) => file.label)).toEqual(["chapters/two.tex", "main.typ"]);
    expect(found.total).toBe(4);
  });

  it("answers an empty query with an empty result", async () => {
    const { results, search } = await setup();
    await search("");
    expect(results()[0]!.results).toEqual({ files: [], total: 0, truncated: false });
  });

  it("opens a searched file by its relative path and ignores any other path", async () => {
    const { ui, search, openMatch } = await setup();
    await search();
    ui.post({ type: "open", path: "proj/main.typ", line: 2, column: 0, length: 3 });
    ui.post({ type: "open", path: "elsewhere/secret.typ", line: 0, column: 0, length: 3 });
    await settle();
    expect(openMatch).toHaveBeenCalledTimes(1);
    expect(openMatch).toHaveBeenCalledWith("main.typ", 2);
  });

  it("rewrites every match of a file, several on one line, and searches again", async () => {
    const { fs, ui, results, search } = await setup();
    await search();
    ui.post({ type: "replaceFile", path: "proj/main.typ", replacement: "dog" });
    await settle();
    expect(await fs.readText("proj/main.typ")).toBe("dog and dog\nno match\ndog");
    expect(await fs.readText("proj/chapters/two.tex")).toBe("a cat\r\nb");
    expect(results().at(-1)!.results.total).toBe(1);
  });

  it("refuses to replace in a file the search did not cover", async () => {
    const { fs, ui, search } = await setup();
    await search();
    await fs.writeText("proj/other.txt", "cat");
    ui.post({ type: "replaceAll", replacement: "dog" });
    await settle();
    expect(await fs.readText("proj/other.txt")).toBe("cat");
    expect(await fs.readText("proj/main.typ")).toBe("cat and cat\nno match\ncat");
  });
});
