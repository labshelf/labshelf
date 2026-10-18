import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { ILogger } from "../../../../../src/ports/index.js";
import type { ToPageMessage } from "../../../../../src/writing/helper/index.js";
import { createDispatcher, type HelperHandlers } from "../../../../../src/writing/helper/node/dispatch/index.js";
import { createLibraryProjects, createProjectHandlers, type LibraryProjects } from "../../../../../src/writing/helper/node/projectHandlers/index.js";

const logs: string[] = [];
const logger = { log: async (_l: string, _m: string, message: string) => { logs.push(message); }, error: async (_m: string, e: unknown) => { logs.push(String(e)); } } as unknown as ILogger;

function setup(handlers: HelperHandlers) {
  const sent: Array<Record<string, unknown>> = [];
  const dispatcher = createDispatcher(handlers, logger);
  const send = (envelope: Record<string, unknown>) => { sent.push(envelope); };
  const handle = (envelope: unknown) => dispatcher.handle(envelope as Record<string, unknown>, new Uint8Array(), send);
  return { sent, handle, drain: () => dispatcher.drain() };
}

async function tempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "labshelf-dispatch-"));
}

async function projectSetup(libraryRoot?: string) {
  const dir = await tempDir();
  const sharedConfigFile = path.join(dir, "config.json");
  if (libraryRoot) { await fs.writeFile(sharedConfigFile, JSON.stringify({ libraryRoot })); }
  const dataDir = path.join(dir, "data");
  const projects: LibraryProjects = createLibraryProjects({ sharedConfigFile, logger });
  const forgotten: string[] = [];
  return { dataDir, projects, forgotten, ...setup(createProjectHandlers({ dataDir, projects, forgetBuilds: (id) => { forgotten.push(id); }, edited: async () => undefined, stopServer: async () => undefined })) };
}

describe("createDispatcher", () => {
  beforeEach(() => { logs.length = 0; });

  it("replies with the parser's code and the request id on a rejected message", async () => {
    const { sent, handle, drain } = setup({});
    handle({ v: 1, id: "5", type: "cancel", projectId: "p" });
    handle({ v: 2, id: "6", type: "cancel" });
    handle("nope");
    await drain();
    expect(sent).toMatchObject([{ type: "error", id: "5", code: "version" }, { type: "error", id: "6", code: "invalid-field" }, { type: "error", id: "0", code: "malformed" }]);
  });

  it("replies unknown-type for lsp and other messages with no handler", async () => {
    const { sent, handle, drain } = setup({});
    handle({ v: 2, id: "3", type: "lsp", projectId: "p", payload: {} });
    await drain();
    expect(sent).toMatchObject([{ type: "error", id: "3", code: "unknown-type" }]);
  });

  it("answers a throwing handler with an internal error and logs it", async () => {
    const { sent, handle, drain } = setup({ save: async () => { throw new Error("disk full"); } });
    handle({ v: 2, id: "4", type: "save", projectId: "p", path: "main.tex" });
    await drain();
    expect(sent).toMatchObject([{ type: "error", id: "4", code: "internal" }]);
    expect(logs.join("\n")).toContain("disk full");
  });

  it("runs messages in order but lets cancel overtake a running handler", async () => {
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const { handle, drain } = setup({
      compile: async () => { order.push("compile:start"); await gate; order.push("compile:end"); },
      save: async () => { order.push("save"); },
      cancel: async () => { order.push("cancel"); release(); },
    });
    handle({ v: 2, id: "1", type: "compile", projectId: "p", main: "main.tex", mode: "preview" });
    handle({ v: 2, id: "2", type: "save", projectId: "p", path: "main.tex" });
    handle({ v: 2, id: "3", type: "cancel", projectId: "p" });
    await drain();
    expect(order).toEqual(["compile:start", "cancel", "compile:end", "save"]);
  });
});

describe("project messages on the socket", () => {
  it("refuses openProject with no-library when no library is set up", async () => {
    const { sent, handle, drain } = await projectSetup();
    handle({ v: 2, id: "1", type: "openProject", projectId: "thesis", root: "writing/thesis" });
    await drain();
    expect(sent).toMatchObject([{ type: "error", id: "1", code: "no-library" }]);
  });

  it("refuses an edit of a project that is not open with project-id", async () => {
    const { sent, handle, drain } = await projectSetup(await tempDir());
    handle({ v: 2, id: "1", type: "edit", projectId: "thesis", path: "main.tex", version: 1, text: "x" });
    await drain();
    expect(sent).toMatchObject([{ type: "error", id: "1", code: "project-id" }]);
  });

  it("opens, edits and closes a project of the library", async () => {
    const library = await tempDir();
    await fs.mkdir(path.join(library, "writing/thesis"), { recursive: true });
    await fs.writeFile(path.join(library, "writing/thesis/main.tex"), "disk");
    const { sent, handle, drain, projects, dataDir, forgotten } = await projectSetup(library);
    const stale = path.join(dataDir, "projects/thesis/src/gone.tex");
    await fs.mkdir(path.dirname(stale), { recursive: true });
    await fs.writeFile(stale, "old");

    handle({ v: 2, id: "1", type: "openProject", projectId: "thesis", root: "writing/thesis" });
    handle({ v: 2, id: "2", type: "edit", projectId: "thesis", path: "main.tex", version: 1, text: "unsaved" });
    await drain();
    expect(sent).toEqual([{ v: 2, id: "1", type: "opened", projectId: "thesis", files: ["main.tex"] }]);
    await expect(projects.textOf("thesis", "main.tex")).resolves.toBe("unsaved");
    await expect(fs.stat(stale)).rejects.toThrow();

    handle({ v: 2, id: "3", type: "closeProject", projectId: "thesis" });
    await drain();
    expect(sent[1]).toEqual({ v: 2, id: "3", type: "closed", projectId: "thesis" });
    expect(() => projects.textOf("thesis", "main.tex")).toThrow(expect.objectContaining({ code: "project-id" }));
    expect(forgotten).toEqual(["thesis", "thesis"]);
  });
});
