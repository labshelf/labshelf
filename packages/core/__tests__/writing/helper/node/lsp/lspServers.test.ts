import { EventEmitter } from "node:events";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { PassThrough } from "node:stream";
import { pathToFileURL } from "node:url";

import type { ILogger } from "../../../../../src/ports/index.js";
import { createLspHandler, createLspServers, type LspChild } from "../../../../../src/writing/helper/node/lsp/index.js";
import { createLspFrameParser, encodeLspFrame } from "../../../../../src/writing/helper/node/lsp/lspFraming.js";

type SpawnOptions = Parameters<Parameters<typeof createLspServers>[0]["spawn"]>[2];

const logs: string[] = [];
const logger = {
  log: async (_l: string, _m: string, message: string) => { logs.push(message); },
  error: async (_m: string, e: unknown) => { logs.push(String(e)); },
} as unknown as ILogger;

class FakeChild extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  killed = false;
  received: Array<Record<string, any>> = [];
  constructor() {
    super();
    const parse = createLspFrameParser((m) => this.received.push(m as Record<string, any>), () => undefined);
    this.stdin.on("data", parse);
  }
  kill = (): boolean => { this.killed = true; this.emit("exit", null, "SIGTERM"); return true; };
  say(message: unknown): void { this.stdout.write(encodeLspFrame(message)); }
}

async function setup() {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "labshelf-lsp-"));
  const children: FakeChild[] & { [i: number]: FakeChild } = [] as never;
  const spawned: SpawnOptions[] = [];
  const texts: Record<string, string> = { "main.typ": "v1 text" };
  const sent: Array<Record<string, any>> & { [i: number]: Record<string, any> } = [] as never;
  const send = (e: unknown) => { sent.push(e as Record<string, any>); };
  const servers = createLspServers({
    dataDir, logger,
    tinymist: { resolve: async () => "/bin/tinymist", ensure: async () => "/bin/tinymist" },
    projects: { syncWorkingCopy: async () => undefined, textOf: async (_id: string, file: string) => texts[file] ?? "" },
    spawn: (_command: string, _args: readonly string[], options: SpawnOptions) => { spawned.push(options); const c = new FakeChild(); children.push(c); return c as unknown as LspChild; },
  } as Parameters<typeof createLspServers>[0]);
  const root = path.join(dataDir, "projects", "p", "src");
  const page = (payload: Record<string, unknown>, project = "p") => servers.relay(project, "1", payload, send);
  const settle = () => new Promise((r) => setTimeout(r, 10));
  return { servers, children, spawned, sent, send, root, texts, page, settle };
}

describe("language server lifecycle", () => {
  beforeEach(() => { logs.length = 0; });

  it("starts one process per project on the first lsp and reuses it", async () => {
    const { children, page, settle } = await setup();
    await page({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    await page({ jsonrpc: "2.0", method: "initialized", params: {} });
    await page({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }, "q");
    await settle();
    expect(children).toHaveLength(2);
    expect(children[0]!.received.map((m) => m.method)).toEqual(["initialize", "initialized"]);
  });

  it("start spawns without a message", async () => {
    const { servers, children, send } = await setup();
    await servers.start("p", "1", send);
    await servers.start("p", "2", send);
    expect(children).toHaveLength(1);
  });

  it("stop and stopAll kill the processes", async () => {
    const { servers, children, page, settle } = await setup();
    await page({ jsonrpc: "2.0", method: "initialized" });
    await page({ jsonrpc: "2.0", method: "initialized" }, "q");
    await servers.stop("p");
    expect(children[0]!.killed).toBe(true);
    expect(children[1]!.killed).toBe(false);
    await servers.stopAll();
    await settle();
    expect(children[1]!.killed).toBe(true);
    await page({ jsonrpc: "2.0", method: "initialized" });
    expect(children).toHaveLength(3);
  });

  it("restarts after an unexpected exit and logs it", async () => {
    const { children, page, settle } = await setup();
    await page({ jsonrpc: "2.0", method: "initialized" });
    children[0]!.emit("exit", 1, null);
    await settle();
    await page({ jsonrpc: "2.0", method: "initialized" });
    expect(children).toHaveLength(2);
    expect(logs).toContain("Language server exited");
  });

  it("relays server messages to the page with page URIs", async () => {
    const { children, sent, page, root, settle } = await setup();
    await page({ jsonrpc: "2.0", method: "initialized" });
    children[0]!.say({ method: "textDocument/publishDiagnostics", params: { uri: pathToFileURL(path.join(root, "a b.typ")).href } });
    await settle();
    expect(sent).toEqual([{ v: 2, type: "lsp", projectId: "p", payload: { method: "textDocument/publishDiagnostics", params: { uri: "labshelf:/a%20b.typ" } } }]);
  });

  it("drops a server notification outside the project and nulls a response field, both logged", async () => {
    const { children, sent, page, settle } = await setup();
    await page({ jsonrpc: "2.0", method: "initialized" });
    children[0]!.say({ method: "window/x", params: { uri: "file:///etc/passwd" } });
    children[0]!.say({ id: 7, result: { uri: "file:///etc/passwd" } });
    await settle();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.payload).toEqual({ id: 7, result: { uri: null } });
    expect(logs.filter((l) => l === "Server named files outside the project")).toHaveLength(2);
  });
});

describe("confinement", () => {
  beforeEach(() => { logs.length = 0; });

  it("starts the server in the working copy with the data folder's package cache and no other helper variable", async () => {
    process.env.LABSHELF_TEST_SECRET = "x";
    try {
      const { children, spawned, page, root } = await setup();
      await page({ jsonrpc: "2.0", method: "initialized" });
      const { env, cwd } = spawned[0]!;
      expect(children).toHaveLength(1);
      expect(cwd).toBe(root);
      const dataDir = path.resolve(root, "..", "..", "..");
      expect(env).toMatchObject({ HOME: dataDir, TYPST_PACKAGE_CACHE_PATH: path.join(dataDir, "typst-packages", "cache"), TYPST_PACKAGE_PATH: path.join(dataDir, "typst-packages", "local") });
      expect(env).not.toHaveProperty("LABSHELF_TEST_SECRET");
    } finally { delete process.env.LABSHELF_TEST_SECRET; }
  });

  it("drops a server workspace/applyEdit that names a file outside the project, answers it as not applied and logs it", async () => {
    const { children, sent, page, settle } = await setup();
    await page({ jsonrpc: "2.0", method: "initialized" });
    children[0]!.say({ jsonrpc: "2.0", id: 5, method: "workspace/applyEdit", params: { edit: { changes: { "file:///etc/hosts": [{ newText: "x" }] } } } });
    children[0]!.say({ jsonrpc: "2.0", id: 6, method: "workspace/applyEdit", params: { edit: { documentChanges: [{ textDocument: { uri: "file:///etc/hosts", version: 1 }, edits: [] }] } } });
    await settle();
    expect(sent).toEqual([]);
    const replies = children[0]!.received.filter((m) => m.id === 5 || m.id === 6);
    expect(replies).toEqual([
      { jsonrpc: "2.0", id: 5, result: { applied: false, failureReason: expect.any(String) } },
      { jsonrpc: "2.0", id: 6, result: { applied: false, failureReason: expect.any(String) } },
    ]);
    expect(logs.filter((l) => l === "Server edit outside the project dropped")).toHaveLength(2);
  });

  it("relays a server workspace/applyEdit whose files are all in the project, keyed by page URI", async () => {
    const { children, sent, page, root, settle } = await setup();
    await page({ jsonrpc: "2.0", method: "initialized" });
    children[0]!.say({ jsonrpc: "2.0", id: 5, method: "workspace/applyEdit", params: { edit: { changes: { [pathToFileURL(path.join(root, "a b.typ")).href]: [{ newText: "x" }] } } } });
    await settle();
    expect(sent[0]!.payload).toEqual({ jsonrpc: "2.0", id: 5, method: "workspace/applyEdit", params: { edit: { changes: { "labshelf:/a%20b.typ": [{ newText: "x" }] } } } });
  });
});

describe("page message handling", () => {
  beforeEach(() => { logs.length = 0; });

  it("rewrites URIs and the initialize root before the server sees them", async () => {
    const { children, page, root } = await setup();
    await page({ jsonrpc: "2.0", id: 1, method: "initialize", params: { rootUri: "labshelf:/" } });
    await page({ jsonrpc: "2.0", method: "textDocument/didOpen", params: { textDocument: { uri: "labshelf:/a%20b.typ", text: "" } } });
    expect(children[0]!.received[0]!.params.rootUri).toBe(pathToFileURL(root).href);
    expect(children[0]!.received[1]!.params.textDocument.uri).toBe(pathToFileURL(path.join(root, "a b.typ")).href);
  });

  it("answers executeCommand requests with -32600 and drops it as a notification", async () => {
    const { children, sent, page } = await setup();
    await page({ jsonrpc: "2.0", id: 9, method: "workspace/executeCommand", params: {} });
    await page({ jsonrpc: "2.0", method: "workspace/executeCommand", params: {} });
    expect(sent).toHaveLength(1);
    expect(sent[0]!).toMatchObject({ type: "lsp", projectId: "p", payload: { id: 9, error: { code: -32600 } } });
    expect(children.flatMap((c) => c.received)).toEqual([]);
  });

  it("refuses a URI leaving the project the same way", async () => {
    const { children, sent, page } = await setup();
    await page({ jsonrpc: "2.0", id: 4, method: "textDocument/hover", params: { textDocument: { uri: "labshelf:/../x.typ" } } });
    await page({ jsonrpc: "2.0", method: "textDocument/didOpen", params: { textDocument: { uri: "labshelf:/../x.typ" } } });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.payload).toMatchObject({ id: 4, error: { code: -32600 } });
    expect(children.flatMap((c) => c.received)).toEqual([]);
  });

  it("refuses a raw file: URI and a raw file: workspace folder the same way", async () => {
    const { children, sent, page } = await setup();
    await page({ jsonrpc: "2.0", id: 4, method: "textDocument/hover", params: { textDocument: { uri: "file:///etc/passwd" } } });
    await page({ jsonrpc: "2.0", method: "textDocument/didOpen", params: { textDocument: { uri: "file:///etc/passwd", text: "" } } });
    await page({ jsonrpc: "2.0", method: "workspace/didChangeWorkspaceFolders", params: { event: { added: [{ uri: "file:///home/ana", name: "x" }], removed: [] } } });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.payload).toMatchObject({ id: 4, error: { code: -32600 } });
    expect(children.flatMap((c) => c.received)).toEqual([]);
  });

  it("passes no page initializationOptions to the server", async () => {
    const { children, page } = await setup();
    await page({ jsonrpc: "2.0", id: 1, method: "initialize", params: { initializationOptions: { rootPath: "/", typstExtraArgs: ["--root", "/"] } } });
    expect(children[0]!.received[0]!.params.initializationOptions).toEqual({});
  });

  it("drops a page workspace/didChangeConfiguration and logs it", async () => {
    const { children, sent, page } = await setup();
    await page({ jsonrpc: "2.0", method: "workspace/didChangeConfiguration", params: { settings: { rootPath: "/" } } });
    expect(children.flatMap((c) => c.received)).toEqual([]);
    expect(sent).toEqual([]);
    expect(logs).toContain("Page message refused");
  });

  it("answers a server workspace/configuration with one null per item and does not relay it", async () => {
    const { children, sent, page, settle } = await setup();
    await page({ jsonrpc: "2.0", method: "initialized" });
    children[0]!.say({ jsonrpc: "2.0", id: 3, method: "workspace/configuration", params: { items: [{ section: "tinymist" }, { section: "editor" }] } });
    await settle();
    expect(sent).toEqual([]);
    expect(children[0]!.received.filter((m) => m.id === 3)).toEqual([{ jsonrpc: "2.0", id: 3, result: [null, null] }]);
  });

  it("the lsp handler relays the message payload", async () => {
    const { servers, children, send } = await setup();
    await createLspHandler(servers)({ v: 2, id: "5", type: "lsp", projectId: "p", payload: { jsonrpc: "2.0", method: "initialized" } } as never, send as never);
    expect(children[0]!.received).toEqual([{ jsonrpc: "2.0", method: "initialized" }]);
  });
});

describe("edited", () => {
  it("sends the full text as didChange for an open document only", async () => {
    const { servers, children, page, root, settle, texts } = await setup();
    await page({ jsonrpc: "2.0", method: "textDocument/didOpen", params: { textDocument: { uri: "labshelf:/main.typ", text: "old" } } });
    await servers.edited("p", "other.typ", 2);
    texts["main.typ"] = "new text";
    await servers.edited("p", "main.typ", 3);
    await settle();
    const changes = children[0]!.received.filter((m) => m.method === "textDocument/didChange");
    expect(changes).toEqual([{ jsonrpc: "2.0", method: "textDocument/didChange", params: { textDocument: { uri: pathToFileURL(path.join(root, "main.typ")).href, version: 3 }, contentChanges: [{ text: "new text" }] } }]);
  });

  it("does nothing when no server runs", async () => {
    const { servers, children } = await setup();
    await servers.edited("p", "main.typ", 1);
    expect(children).toHaveLength(0);
  });
});
