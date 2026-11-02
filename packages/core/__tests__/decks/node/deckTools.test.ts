// Hidden tests of spec 2.3: the seven deck tools over a temp project, driven through createMcpServer, with validated and confined writes.
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { applyDeckEdit, listDeckRules, listDeckSizePresets, type DeckDiagnostic, type DeckEdit, type DeckRule } from "../../../src/decks/index.js";
import { createDeckTools } from "../../../src/decks/node/deckTools.js";
import { createMcpServer } from "../../../src/mcp/mcpServer.js";
import type { ILogger } from "../../../src/ports/index.js";
import type { ReadyProject } from "../../../src/writing/project/projectEntry.js";
import { SAMPLE_TALK, THEME, block, talk } from "../deckSamples.js";

const TOOL_NAMES = ["deck_rules", "project_context", "deck_list", "deck_read", "deck_create", "deck_edit", "deck_validate"];
const PATH_REFUSAL = "Decks live in talks/<name>/ or posters/<name>/ of the project.";
const OUTSIDE_REFUSAL = "The deck folder resolves outside the project.";
const PLOT = Buffer.from("not really a png, but bytes all the same");

interface ToolValue {
  ok?: boolean; error?: string; diagnostics?: DeckDiagnostic[]; deck?: string; html?: string; theme?: string; files?: string[];
  folders?: string[]; vocabulary?: unknown[]; presets?: unknown[]; rules?: DeckRule[];
}
interface ToolOutcome { isError: boolean; value: ToolValue; text: string }
interface RpcResponse { id?: number; result?: Record<string, unknown>; error?: { code: number; message: string } }

let root: string;
let project: string;
let outside: string;
let logger: ILogger & { log: jest.Mock; error: jest.Mock };
let server: ReturnType<typeof createMcpServer>;
let nextId = 0;

beforeEach(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "labshelf-decktools-")));
  project = path.join(root, "project");
  outside = path.join(root, "outside");
  await fs.mkdir(project, { recursive: true });
  await fs.mkdir(outside, { recursive: true });
  await fs.writeFile(path.join(project, "labshelf.yaml"), "id: talkproj\nformat: latex\nmain: main.tex\n");
  await fs.writeFile(path.join(project, "main.tex"), "\\documentclass{article}\n\\begin{document}\n\\section{Intro}\nHello.\n\\end{document}\n");
  logger = { log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) };
  const ready = {
    kind: "ready", folder: project, location: "external",
    settings: { id: "talkproj", format: "latex", main: "main.tex" } as unknown as ReadyProject["settings"], main: "main.tex",
  } as ReadyProject;
  server = createMcpServer({ name: "labshelf", version: "0.0.0-test", tools: createDeckTools(ready, { logger }) });
  await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "jest", version: "1" } });
  await server.handle(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }));
});

afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

async function rpc(method: string, params?: unknown): Promise<RpcResponse> {
  nextId += 1;
  const id = nextId;
  const lines: string[] = await server.handle(JSON.stringify({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) }));
  const response = lines.map((line: string): RpcResponse => JSON.parse(line) as RpcResponse).find((r: RpcResponse) => r.id === id);
  if (!response) throw new Error(`no response to ${method}`);
  return response;
}

async function callTool(name: string, args: Record<string, unknown>): Promise<ToolOutcome> {
  const response = await rpc("tools/call", { name, arguments: args });
  expect(response.error).toBeUndefined();
  const content = response.result?.["content"] as Array<{ type: string; text: string }>;
  expect(content).toHaveLength(1);
  expect(content[0]?.type).toBe("text");
  const text = content[0]?.text ?? "";
  return { isError: response.result?.["isError"] === true, value: JSON.parse(text) as ToolValue, text };
}

const b64 = (bytes: Buffer): string => bytes.toString("base64");
const deckFile = (deck: string, file: string): string => path.join(project, deck, file);
const read = (file: string): Promise<string> => fs.readFile(file, "utf8");
const exists = (file: string): Promise<boolean> => fs.lstat(file).then(() => true, () => false);

/** Every file under dir (relative path → content), symlinks not followed; directories alone are not listed. */
async function fileTree(dir: string, prefix = ""): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const entry of await fs.readdir(path.join(dir, prefix), { withFileTypes: true }).catch(() => [])) {
    const rel = path.join(prefix, entry.name);
    if (entry.isDirectory()) Object.assign(out, await fileTree(dir, rel));
    else if (entry.isSymbolicLink()) out[rel] = `-> ${await fs.readlink(path.join(dir, rel))}`;
    else out[rel] = (await fs.readFile(path.join(dir, rel))).toString("base64");
  }
  return out;
}

async function bothTrees(): Promise<[Record<string, string>, Record<string, string>]> {
  return [await fileTree(project), await fileTree(outside)];
}

async function createSampleTalk(name = "intro"): Promise<string> {
  const created = await callTool("deck_create", { name, kind: "talk", html: SAMPLE_TALK, theme: THEME, assets: [{ path: "assets/plot.png", base64: b64(PLOT) }] });
  expect(created.isError).toBe(false);
  expect(created.value.ok).toBe(true);
  return `talks/${name}`;
}

function expectRefused(outcome: ToolOutcome): void {
  expect(outcome.isError).toBe(true);
  expect(outcome.value.ok).toBe(false);
}

const codes = (diagnostics: DeckDiagnostic[] | undefined): string[] => (diagnostics ?? []).map((d) => d.code);

describe("deck tools", () => {
  it("2.3a tools/list lists the seven deck tools in order, each with a strict object inputSchema", async () => {
    const response = await rpc("tools/list");
    const tools = response.result?.["tools"] as Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>;
    expect(tools.map((t) => t.name)).toEqual(TOOL_NAMES);
    for (const tool of tools) {
      expect(typeof tool.description).toBe("string");
      expect(tool.description.length).toBeGreaterThan(0);
      expect(tool.inputSchema["type"]).toBe("object");
      expect(tool.inputSchema["additionalProperties"]).toBe(false);
      expect(typeof tool.inputSchema["properties"]).toBe("object");
      expect(Array.isArray(tool.inputSchema["required"])).toBe(true);
    }
  });

  it("2.3a createDeckTools returns the tools in the same order", () => {
    const ready = { kind: "ready", folder: project, location: "external", settings: {} as ReadyProject["settings"], main: "main.tex" } as ReadyProject;
    const tools: Array<{ name: string }> = createDeckTools(ready, { logger });
    expect(tools.map((t: { name: string }) => t.name)).toEqual(TOOL_NAMES);
  });

  it("A2 deck_rules gives the folders, the vocabulary, the size presets and the deck rules", async () => {
    const rules = await callTool("deck_rules", {});
    expect(rules.isError).toBe(false);
    expect(rules.text).toBe(JSON.stringify(rules.value, null, 2));
    expect(rules.value.folders).toEqual(["talks/<name>/", "posters/<name>/"]);
    expect(rules.value.presets).toEqual([...listDeckSizePresets("talk"), ...listDeckSizePresets("poster")]);
    expect(rules.value.rules).toEqual(listDeckRules());
    expect(Array.isArray(rules.value.vocabulary)).toBe(true);
    expect((rules.value.vocabulary ?? []).length).toBeGreaterThan(0);
    for (const sentence of rules.value.vocabulary ?? []) expect(typeof sentence).toBe("string");
  });

  it("2.3b deck_create scaffolds a talk that deck_read returns with no diagnostics", async () => {
    const created = await callTool("deck_create", { name: "intro", kind: "talk" });
    expect(created.isError).toBe(false);
    expect(created.value.ok).toBe(true);
    expect(created.value.deck).toMatch(/^talks\/intro\/?$/);
    const html = await read(deckFile("talks/intro", "deck.html"));
    expect(html).toContain('data-deck="talk"');
    const theme = await read(deckFile("talks/intro", "theme.css"));
    const deck = await callTool("deck_read", { deck: "talks/intro" });
    expect(deck.isError).toBe(false);
    expect(deck.value.html).toBe(html);
    expect(deck.value.theme).toBe(theme);
    expect(deck.value.diagnostics).toEqual([]);
    expect(deck.value.files).toEqual(expect.arrayContaining(["deck.html", "theme.css"]));
    expect(deck.value.files).toEqual([...(deck.value.files ?? [])].sort());
  });

  it("2.3b deck_create scaffolds a poster that deck_read returns with no diagnostics", async () => {
    const created = await callTool("deck_create", { name: "summary", kind: "poster" });
    expect(created.value.ok).toBe(true);
    expect(created.value.deck).toMatch(/^posters\/summary\/?$/);
    const deck = await callTool("deck_read", { deck: "posters/summary" });
    expect(deck.value.html).toBe(await read(deckFile("posters/summary", "deck.html")));
    expect(deck.value.html).toContain('data-deck="poster"');
    expect(deck.value.diagnostics).toEqual([]);
  });

  it("2.3b deck_create writes the given html, theme and assets", async () => {
    const deck = await createSampleTalk();
    expect(await read(deckFile(deck, "deck.html"))).toBe(SAMPLE_TALK);
    expect(await read(deckFile(deck, "theme.css"))).toBe(THEME);
    expect(Buffer.compare(await fs.readFile(deckFile(deck, "assets/plot.png")), PLOT)).toBe(0);
    const readBack = await callTool("deck_read", { deck });
    expect(readBack.value.files).toEqual(["assets/plot.png", "deck.html", "theme.css"]);
    expect(readBack.value.theme).toBe(THEME);
  });

  it("2.3b deck_create accepts an asset of exactly 5 MiB", async () => {
    const big = Buffer.alloc(5242880, 7);
    const created = await callTool("deck_create", { name: "big", kind: "talk", html: SAMPLE_TALK, theme: THEME, assets: [{ path: "assets/plot.png", base64: b64(big) }] });
    expect(created.value.ok).toBe(true);
    expect((await fs.stat(deckFile("talks/big", "assets/plot.png"))).size).toBe(5242880);
  });

  it("2.3b deck_create refuses an asset over 5 MB and writes nothing", async () => {
    const before = await bothTrees();
    const created = await callTool("deck_create", { name: "big", kind: "talk", html: SAMPLE_TALK, theme: THEME, assets: [{ path: "assets/plot.png", base64: b64(Buffer.alloc(5242881, 7)) }] });
    expectRefused(created);
    expect(created.value.error).toBe("Asset assets/plot.png is larger than 5 MB.");
    expect(await bothTrees()).toEqual(before);
  });

  it.each(["../evil.png", "assets/../../evil.png", "assets/../../../outside/evil.png"])("2.3b deck_create refuses the asset path %s and writes nothing", async (assetPath) => {
    const before = await bothTrees();
    const created = await callTool("deck_create", { name: "intro", kind: "talk", assets: [{ path: assetPath, base64: b64(PLOT) }] });
    expectRefused(created);
    expect(await bothTrees()).toEqual(before);
  });

  it("2.3b deck_create refuses an existing deck and leaves it unchanged", async () => {
    const deck = await createSampleTalk();
    const before = await bothTrees();
    expectRefused(await callTool("deck_create", { name: "intro", kind: "talk" }));
    expect(await bothTrees()).toEqual(before);
    expect(await read(deckFile(deck, "deck.html"))).toBe(SAMPLE_TALK);
  });

  it("2.3b deck_create refuses an argument of the wrong type, naming it", async () => {
    const created = await callTool("deck_create", { name: 5, kind: "talk" });
    expectRefused(created);
    expect(created.value.error).toContain("name");
    expect(await exists(path.join(project, "talks"))).toBe(false);
  });

  it("2.3b deck_create refuses an unknown kind", async () => {
    expectRefused(await callTool("deck_create", { name: "intro", kind: "handout" }));
    expect(await exists(deckFile("talks/intro", "deck.html"))).toBe(false);
  });

  it("2.3c deck_edit applies a DeckEdit list in order", async () => {
    const deck = await createSampleTalk();
    const edits: DeckEdit[] = [
      { kind: "move", block: "title", left: 200, top: 90 },
      { kind: "resize", block: "title", left: 210, top: 100, width: 1500, height: 180 },
    ];
    let expected = SAMPLE_TALK;
    for (const edit of edits) {
      const step = applyDeckEdit(expected, edit);
      if (!step.ok) throw new Error(step.error);
      expected = step.html;
    }
    const edited = await callTool("deck_edit", { deck, edits });
    expect(edited.isError).toBe(false);
    expect(edited.value.ok).toBe(true);
    expect(edited.value.deck).toMatch(/^talks\/intro\/?$/);
    expect(await read(deckFile(deck, "deck.html"))).toBe(expected);
    expect(await read(deckFile(deck, "theme.css"))).toBe(THEME);
  });

  it("2.3c deck_edit replaces the html", async () => {
    const deck = await createSampleTalk();
    const html = talk(block("lead", "<p>Replaced</p>"));
    const edited = await callTool("deck_edit", { deck, html });
    expect(edited.value.ok).toBe(true);
    expect(await read(deckFile(deck, "deck.html"))).toBe(html);
    expect(await read(deckFile(deck, "theme.css"))).toBe(THEME);
  });

  it("2.3c deck_edit replaces the theme and keeps the html", async () => {
    const deck = await createSampleTalk();
    const theme = ":root { --deck-bg: #000000; --deck-fg: #fafafa; }\n";
    const edited = await callTool("deck_edit", { deck, theme });
    expect(edited.value.ok).toBe(true);
    expect(await read(deckFile(deck, "theme.css"))).toBe(theme);
    expect(await read(deckFile(deck, "deck.html"))).toBe(SAMPLE_TALK);
  });

  it("2.3c deck_edit refuses with the first failing edit's error and leaves files unchanged", async () => {
    const deck = await createSampleTalk();
    const first: DeckEdit = { kind: "move", block: "title", left: 200, top: 90 };
    const failing: DeckEdit = { kind: "move", block: "nope", left: 1, top: 1 };
    const step = applyDeckEdit(SAMPLE_TALK, first);
    if (!step.ok) throw new Error(step.error);
    const expected = applyDeckEdit(step.html, failing);
    if (expected.ok) throw new Error("the failing edit should fail");
    const before = await bothTrees();
    const edited = await callTool("deck_edit", { deck, edits: [first, failing, { kind: "deleteBlock", block: "body" }] });
    expectRefused(edited);
    expect(edited.value.error).toBe(expected.error);
    expect(await bothTrees()).toEqual(before);
  });

  it("2.3c deck_edit refuses a validation error with the diagnostics, leaves files unchanged and logs no deck text", async () => {
    const deck = await createSampleTalk();
    const before = await bothTrees();
    const html = SAMPLE_TALK.replace("</body>", "<script>alert('deck-secret')</script>\n</body>");
    const edited = await callTool("deck_edit", { deck, html, theme: ":root { --deck-bg: #123456; }\n" });
    expectRefused(edited);
    expect(codes(edited.value.diagnostics)).toContain("DECK013");
    expect(await bothTrees()).toEqual(before);
    const logged = JSON.stringify([...logger.log.mock.calls, ...logger.error.mock.calls]);
    expect(logged).not.toContain("deck-secret");
  });

  it("2.3c deck_edit refuses an edit list whose result breaks a rule and leaves files unchanged", async () => {
    const deck = await createSampleTalk();
    const before = await bothTrees();
    const edited = await callTool("deck_edit", { deck, edits: [{ kind: "addBlock", slide: 0, html: block("evil", "<p>x</p>", undefined, ' onclick="alert(1)"') }] });
    expectRefused(edited);
    expect(await bothTrees()).toEqual(before);
  });

  it("2.3c deck_edit returns warnings and still writes", async () => {
    const deck = await createSampleTalk();
    const html = talk(block("wide", "<p>Wide</p>", "left: 1800px; top: 80px; width: 400px; height: 200px;"));
    const edited = await callTool("deck_edit", { deck, html });
    expect(edited.isError).toBe(false);
    expect(edited.value.ok).toBe(true);
    expect(codes(edited.value.diagnostics)).toContain("DECK012");
    for (const d of edited.value.diagnostics ?? []) expect(d.severity).toBe("warning");
    expect(await read(deckFile(deck, "deck.html"))).toBe(html);
  });

  it("2.3c deck_edit refuses a call with nothing to change", async () => {
    const deck = await createSampleTalk();
    const before = await bothTrees();
    expectRefused(await callTool("deck_edit", { deck }));
    expect(await bothTrees()).toEqual(before);
  });

  it("2.3c deck_edit refuses a deck that does not exist and writes nothing", async () => {
    const before = await bothTrees();
    expectRefused(await callTool("deck_edit", { deck: "talks/missing", html: SAMPLE_TALK }));
    expect(await bothTrees()).toEqual(before);
  });

  it("2.3c deck_validate reports diagnostics of given html without isError or writes", async () => {
    await createSampleTalk();
    const before = await bothTrees();
    const checked = await callTool("deck_validate", { html: talk("<script>alert(1)</script>"), theme: THEME });
    expect(checked.isError).toBe(false);
    expect(codes(checked.value.diagnostics)).toContain("DECK013");
    expect(await bothTrees()).toEqual(before);
  });

  it("2.3c deck_validate of a stored deck matches deck_read's diagnostics", async () => {
    const deck = await createSampleTalk();
    const checked = await callTool("deck_validate", { deck });
    const readBack = await callTool("deck_read", { deck });
    expect(checked.isError).toBe(false);
    expect(checked.value.diagnostics).toEqual(readBack.value.diagnostics);
  });

  it.each(["talks/intro/", "talks/intro/deck.html"])("2.3d deck_read accepts the deck path %s", async (deckPath) => {
    await createSampleTalk();
    const readBack = await callTool("deck_read", { deck: deckPath });
    expect(readBack.isError).toBe(false);
    expect(readBack.value.html).toBe(SAMPLE_TALK);
  });

  it.each(["chapters/x", "../x", "talks/../../x", "talks", "talks/a/b", "talks/x/notes.html", "/tmp/talks/x", "handouts/x"])(
    "2.3d deck_edit refuses the deck path %s with nothing written",
    async (deckPath) => {
      const before = await bothTrees();
      const edited = await callTool("deck_edit", { deck: deckPath, html: SAMPLE_TALK });
      expectRefused(edited);
      expect(edited.value.error).toBe(PATH_REFUSAL);
      expect(await bothTrees()).toEqual(before);
      expect(await exists(path.join(root, "x"))).toBe(false);
    },
  );

  it.each(["../x", "x/y", "..", ""])("2.3d deck_create refuses the name %p with nothing written", async (name) => {
    const before = await bothTrees();
    expectRefused(await callTool("deck_create", { name, kind: "talk" }));
    expect(await bothTrees()).toEqual(before);
    expect(await exists(path.join(root, "x"))).toBe(false);
  });

  it("2.3d deck_create refuses a symlinked talks folder that resolves outside the project", async () => {
    await fs.symlink(outside, path.join(project, "talks"), "dir");
    const created = await callTool("deck_create", { name: "intro", kind: "talk" });
    expectRefused(created);
    expect(created.value.error).toBe(OUTSIDE_REFUSAL);
    expect(await fileTree(outside)).toEqual({});
  });

  it("2.3d deck_edit refuses a symlinked deck folder that resolves outside the project", async () => {
    await fs.writeFile(path.join(outside, "deck.html"), SAMPLE_TALK);
    await fs.writeFile(path.join(outside, "theme.css"), THEME);
    await fs.mkdir(path.join(project, "talks"));
    await fs.symlink(outside, path.join(project, "talks", "intro"), "dir");
    const before = await bothTrees();
    const edited = await callTool("deck_edit", { deck: "talks/intro", html: talk(block("lead")) });
    expectRefused(edited);
    expect(edited.value.error).toBe(OUTSIDE_REFUSAL);
    expect(await bothTrees()).toEqual(before);
  });

  it("2.3d deck_edit refuses a symlinked asset folder inside the deck that leads outside", async () => {
    const deck = await createSampleTalk();
    await fs.symlink(outside, deckFile(deck, "media"), "dir");
    const before = await bothTrees();
    expectRefused(await callTool("deck_edit", { deck, assets: [{ path: "media/new.png", base64: b64(PLOT) }] }));
    expect(await bothTrees()).toEqual(before);
  });

  it("2.3d deck_edit refuses to write through an existing target that is a symlink", async () => {
    const deck = await createSampleTalk();
    const target = path.join(outside, "victim.css");
    await fs.writeFile(target, "/* keep */\n");
    await fs.rm(deckFile(deck, "theme.css"));
    await fs.symlink(target, deckFile(deck, "theme.css"));
    const before = await bothTrees();
    expectRefused(await callTool("deck_edit", { deck, theme: ":root { --deck-bg: #000000; }\n" }));
    expect(await bothTrees()).toEqual(before);
    expect(await read(target)).toBe("/* keep */\n");
  });
});
