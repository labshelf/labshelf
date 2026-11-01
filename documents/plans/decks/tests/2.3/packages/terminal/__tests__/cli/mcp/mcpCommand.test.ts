// Hidden tests of spec 2.3: `labshelf mcp` serves a temp library project's decks over in-memory stdio streams.
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { PassThrough } from "node:stream";

import type { ILogger } from "@labshelf/core";

import { runMcp } from "../../../src/cli/mcp/mcpCommand";
import { cleanupTempDirs, createTempLibrary, makeTempDir } from "../../fixtures/library";

afterEach(cleanupTempDirs);

interface RpcMessage { jsonrpc?: string; id?: number; result?: Record<string, unknown>; error?: { code: number; message: string } }
interface ToolValue { ok?: boolean; error?: string; deck?: string; html?: string; diagnostics?: Array<{ code: string; severity: string }>; rules?: Array<{ code: string }>; folders?: string[] }

const logger = (): ILogger => ({ log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) });

async function setupProject(): Promise<{ library: string; folder: string; outside: string }> {
  const lib = await createTempLibrary();
  const folder = path.join(lib.root, "projects", "talkproj");
  await fs.mkdir(folder, { recursive: true });
  await fs.writeFile(path.join(folder, "labshelf.yaml"), "id: talkproj\nformat: latex\nmain: main.tex\n");
  await fs.writeFile(path.join(folder, "main.tex"), "\\documentclass{article}\n\\begin{document}\nHello.\n\\end{document}\n");
  const outside = await makeTempDir("labshelf-mcp-outside-");
  return { library: lib.root, folder, outside };
}

/** Starts runMcp over PassThrough streams; requests wait for the response with their id. */
function startMcp(options: { libraryRoot: string; project?: string; cwd: string }) {
  const input = new PassThrough();
  const output = new PassThrough();
  const lines: string[] = [];
  const waiters = new Map<number, (message: RpcMessage) => void>();
  let buffer = "";
  output.on("data", (chunk: Buffer | string) => {
    buffer += chunk.toString();
    let at = buffer.indexOf("\n");
    while (at >= 0) {
      const line = buffer.slice(0, at);
      buffer = buffer.slice(at + 1);
      at = buffer.indexOf("\n");
      if (line.trim() === "") continue;
      lines.push(line);
      try {
        const message = JSON.parse(line) as RpcMessage;
        if (typeof message.id === "number") waiters.get(message.id)?.(message);
      } catch { /* a non-JSON line fails the stdout check below */ }
    }
  });
  const exit: Promise<number> = runMcp({ ...options, input, output, logger: logger(), version: "0.0.0-test" });
  let nextId = 0;
  const request = (method: string, params?: unknown): Promise<RpcMessage> => {
    nextId += 1;
    const id = nextId;
    const answered = new Promise<RpcMessage>((resolve) => { waiters.set(id, resolve); });
    input.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) })}\n`);
    return Promise.race([answered, exit.then((code: number) => { throw new Error(`runMcp exited with ${code} before answering ${method}`); })]);
  };
  const notify = (method: string): void => { input.write(`${JSON.stringify({ jsonrpc: "2.0", method })}\n`); };
  const callTool = async (name: string, args: Record<string, unknown>): Promise<{ isError: boolean; value: ToolValue }> => {
    const response = await request("tools/call", { name, arguments: args });
    expect(response.error).toBeUndefined();
    const content = response.result?.["content"] as Array<{ type: string; text: string }>;
    return { isError: response.result?.["isError"] === true, value: JSON.parse(content[0]?.text ?? "null") as ToolValue };
  };
  const close = async (): Promise<number> => { input.end(); return exit; };
  return { request, notify, callTool, close, lines, exit, output };
}

async function initialize(client: ReturnType<typeof startMcp>): Promise<RpcMessage> {
  const response = await client.request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "jest", version: "1" } });
  client.notify("notifications/initialized");
  return response;
}

async function filesUnder(dir: string, prefix = ""): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await fs.readdir(path.join(dir, prefix), { withFileTypes: true }).catch(() => [])) {
    const rel = path.join(prefix, entry.name);
    if (entry.isDirectory()) out.push(...await filesUnder(dir, rel));
    else out.push(rel);
  }
  return out.sort();
}

describe("labshelf mcp", () => {
  it("2.3e serves a library project named by folder and returns 0 at end of input", async () => {
    const { library, folder } = await setupProject();
    const client = startMcp({ libraryRoot: library, project: folder, cwd: library });
    const init = await initialize(client);
    expect(init.result?.["protocolVersion"]).toBe("2025-06-18");
    const list = await client.request("tools/list");
    const names = (list.result?.["tools"] as Array<{ name: string }>).map((t) => t.name);
    expect(names).toEqual(["deck_rules", "project_context", "deck_list", "deck_read", "deck_create", "deck_edit", "deck_validate"]);
    expect(await client.close()).toBe(0);
    for (const line of client.lines) expect((JSON.parse(line) as RpcMessage).jsonrpc).toBe("2.0");
  });

  it("2.3e serves the project holding the cwd when no project is named", async () => {
    const { library, folder } = await setupProject();
    const client = startMcp({ libraryRoot: library, cwd: folder });
    await initialize(client);
    const created = await client.callTool("deck_create", { name: "intro", kind: "talk" });
    expect(created.value.ok).toBe(true);
    expect(await client.close()).toBe(0);
    await expect(fs.stat(path.join(folder, "talks", "intro", "deck.html"))).resolves.toBeTruthy();
  });

  it("2.3e serves a library project named by id", async () => {
    const { library, folder } = await setupProject();
    const client = startMcp({ libraryRoot: library, project: "talkproj", cwd: library });
    await initialize(client);
    expect((await client.callTool("deck_create", { name: "intro", kind: "talk" })).value.ok).toBe(true);
    expect(await client.close()).toBe(0);
    await expect(fs.stat(path.join(folder, "talks", "intro", "deck.html"))).resolves.toBeTruthy();
  });

  it("2.3e an unknown project gives a non-zero exit code and nothing on output", async () => {
    const { library } = await setupProject();
    const client = startMcp({ libraryRoot: library, project: "no-such-project", cwd: library });
    const code = await client.exit;
    expect(code).not.toBe(0);
    expect(client.lines).toEqual([]);
    expect(client.output.readableLength).toBe(0);
  });

  it("2.3e no project around the cwd gives a non-zero exit code and nothing on output", async () => {
    const { library } = await setupProject();
    const elsewhere = await makeTempDir("labshelf-mcp-cwd-");
    const client = startMcp({ libraryRoot: library, cwd: elsewhere });
    expect(await client.exit).not.toBe(0);
    expect(client.lines).toEqual([]);
  });

  it("A2 a client gets the rules, creates a deck, has a rule-breaking write and writes outside the deck folders refused", async () => {
    const { library, folder, outside } = await setupProject();
    await fs.symlink(outside, path.join(folder, "posters"), "dir");
    const client = startMcp({ libraryRoot: library, project: folder, cwd: library });
    await initialize(client);

    const rules = await client.callTool("deck_rules", {});
    expect(rules.isError).toBe(false);
    expect(rules.value.folders).toEqual(["talks/<name>/", "posters/<name>/"]);
    expect(rules.value.rules?.map((r) => r.code)).toContain("DECK013");

    const created = await client.callTool("deck_create", { name: "intro", kind: "talk" });
    expect(created.isError).toBe(false);
    expect(created.value.ok).toBe(true);
    const deckHtml = path.join(folder, "talks", "intro", "deck.html");
    const stored = await fs.readFile(deckHtml, "utf8");

    const readBack = await client.callTool("deck_read", { deck: "talks/intro" });
    expect(readBack.value.html).toBe(stored);
    expect(readBack.value.diagnostics).toEqual([]);

    const scripted = stored.replace("</body>", "<script>alert(1)</script>\n</body>");
    const refused = await client.callTool("deck_edit", { deck: "talks/intro", html: scripted });
    expect(refused.isError).toBe(true);
    expect(refused.value.ok).toBe(false);
    expect(refused.value.diagnostics?.map((d) => d.code)).toContain("DECK013");
    expect(await fs.readFile(deckHtml, "utf8")).toBe(stored);

    const projectFiles = await filesUnder(folder);
    for (const deck of ["../x", "chapters/x"]) {
      const outsideWrite = await client.callTool("deck_edit", { deck, html: stored });
      expect(outsideWrite.isError).toBe(true);
      expect(outsideWrite.value.error).toBe("Decks live in talks/<name>/ or posters/<name>/ of the project.");
    }
    const symlinked = await client.callTool("deck_create", { name: "summary", kind: "poster" });
    expect(symlinked.isError).toBe(true);
    expect(symlinked.value.error).toBe("The deck folder resolves outside the project.");
    expect(await filesUnder(folder)).toEqual(projectFiles);
    expect(await filesUnder(outside)).toEqual([]);
    await expect(fs.stat(path.join(path.dirname(folder), "x"))).rejects.toThrow();

    expect(await client.close()).toBe(0);
    for (const line of client.lines) expect((JSON.parse(line) as RpcMessage).jsonrpc).toBe("2.0");
  });
});
