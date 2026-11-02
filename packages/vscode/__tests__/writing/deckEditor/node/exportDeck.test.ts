/** @jest-environment node */
// Tests the desktop deck export: Export HTML beside the deck, Export PDF through exportDeckPdf with its fallback, and the wiring into registerNodeWriting only.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";

import { registerDeckExport, runDeckExport, type DeckExportDeps } from "../../../../src/writing/deckEditor/node/exportDeck";

jest.mock("vscode", () => {
  const actual = jest.requireActual("vscode");
  // Mock gap: Uri.prototype.with.
  actual.Uri.prototype.with = function (this: InstanceType<typeof actual.Uri>, change: Record<string, string | undefined>) {
    const next = new actual.Uri(
      change.scheme ?? this.scheme, change.authority ?? this.authority, change.path ?? this.path,
      change.query ?? this.query, change.fragment ?? this.fragment,
    );
    next.fsPath = change.path ?? this.fsPath;
    return next;
  };
  if (!actual.window.tabGroups.activeTabGroup) { actual.window.tabGroups.activeTabGroup = { activeTab: undefined }; }
  return actual;
});

const pkgRoot = path.resolve(__dirname, "../../../..");
const srcRoot = path.join(pkgRoot, "src");

const DECK = "<!doctype html><html><head><link rel=\"stylesheet\" href=\"theme.css\"></head><body><section class=\"slide\"><img src=\"assets/pic.png\"></section></body></html>";
const THEME = ":root { --accent: #c00; }";
const PIC = Buffer.from([137, 80, 78, 71, 1, 2, 3]);

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i += 1) { await new Promise((resolve) => setImmediate(resolve)); }
}

function fakeLogger() {
  const logger = {
    log: jest.fn(async () => undefined),
    error: jest.fn(async () => undefined),
    warn: jest.fn(async () => undefined),
    info: jest.fn(async () => undefined),
    debug: jest.fn(async () => undefined),
  };
  return logger;
}

function loggerWasUsed(logger: ReturnType<typeof fakeLogger>): boolean {
  return Object.values(logger).some((fn) => fn.mock.calls.length > 0);
}

interface Fixture { root: string; deckDir: string; deckPath: string; deckUri: vscode.Uri; doc: { isDirty: boolean; save: jest.Mock } }

let tmpRoots: string[] = [];

function makeDeck(options: { dirty?: string } = {}): Fixture {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "labshelf-deck-export-")));
  tmpRoots.push(root);
  const deckDir = path.join(root, "talks", "intro");
  fs.mkdirSync(path.join(deckDir, "assets"), { recursive: true });
  const deckPath = path.join(deckDir, "deck.html");
  fs.writeFileSync(deckPath, DECK);
  fs.writeFileSync(path.join(deckDir, "theme.css"), THEME);
  fs.writeFileSync(path.join(deckDir, "assets", "pic.png"), PIC);
  const deckUri = vscode.Uri.file(deckPath);
  let memory = options.dirty;
  const doc = {
    uri: deckUri,
    fileName: deckPath,
    languageId: "html",
    get isDirty() { return memory !== undefined; },
    getText: () => memory ?? fs.readFileSync(deckPath, "utf8"),
    save: jest.fn(async () => {
      if (memory !== undefined) { fs.writeFileSync(deckPath, memory); memory = undefined; }
      return true;
    }),
  };
  (vscode.workspace as unknown as { textDocuments: unknown[] }).textDocuments = [doc];
  (vscode.workspace.openTextDocument as jest.Mock).mockImplementation(async () => doc);
  return { root, deckDir, deckPath, deckUri, doc: doc as unknown as Fixture["doc"] };
}

function deps(overrides: Partial<DeckExportDeps> = {}) {
  const logger = fakeLogger();
  const exportHtml = jest.fn(async () => "<!doctype html><p>EXPORTED SINGLE FILE</p>");
  const exportPdf = jest.fn(async (_html: string, options: { out: string }) => {
    fs.writeFileSync(options.out, "%PDF-1.7");
    return { kind: "pdf" as const, path: options.out };
  });
  const all = { exportHtml, exportPdf, logger, ...overrides } as unknown as DeckExportDeps;
  return { deps: all, logger, exportHtml: all.exportHtml as unknown as jest.Mock, exportPdf: all.exportPdf as unknown as jest.Mock };
}

function infoCall(fragment: string): unknown[] | undefined {
  return (vscode.window.showInformationMessage as jest.Mock).mock.calls.find((call) => String(call[0]).includes(fragment));
}

function chromiumFake(status: unknown) {
  return { status: jest.fn(async () => status), install: jest.fn(async () => "/managed/chrome") };
}

beforeEach(() => {
  jest.clearAllMocks();
  (vscode.window.showInformationMessage as jest.Mock).mockImplementation(async () => undefined);
  (vscode.window.showWarningMessage as jest.Mock).mockImplementation(async () => undefined);
  const wfs = vscode.workspace.fs as unknown as Record<string, jest.Mock>;
  wfs.readFile!.mockImplementation(async (uri: vscode.Uri) => new Uint8Array(fs.readFileSync(uri.fsPath)));
  wfs.writeFile!.mockImplementation(async (uri: vscode.Uri, bytes: Uint8Array) => { fs.writeFileSync(uri.fsPath, bytes); });
  wfs.stat!.mockImplementation(async (uri: vscode.Uri) => {
    const stat = fs.statSync(uri.fsPath);
    return { type: stat.isDirectory() ? 2 : 1, ctime: 0, mtime: stat.mtimeMs, size: stat.size };
  });
  wfs.readDirectory!.mockImplementation(async (uri: vscode.Uri) =>
    fs.readdirSync(uri.fsPath, { withFileTypes: true }).map((entry) => [entry.name, entry.isDirectory() ? 2 : 1]));
});

afterEach(() => {
  for (const root of tmpRoots) { fs.rmSync(root, { recursive: true, force: true }); }
  tmpRoots = [];
});

describe("Export HTML", () => {
  it("8.3a writes <folder name>.html beside the deck with exportDeckHtml's output", async () => {
    const fx = makeDeck();
    const { deps: d } = deps();
    const result = await runDeckExport(fx.deckUri, "html", d);
    const out = path.join(fx.deckDir, "intro.html");
    expect(fs.readFileSync(out, "utf8")).toBe("<!doctype html><p>EXPORTED SINGLE FILE</p>");
    expect(result?.fsPath).toBe(out);
  });

  it("8.3a passes the deck html and the deck folder's theme.css to exportDeckHtml", async () => {
    const fx = makeDeck();
    const { deps: d, exportHtml } = deps();
    await runDeckExport(fx.deckUri, "html", d);
    expect(exportHtml).toHaveBeenCalledTimes(1);
    const [html, options] = exportHtml.mock.calls[0]!;
    expect(html).toBe(DECK);
    expect(options.theme).toBe(THEME);
  });

  it("8.3a gives exportDeckHtml a readAsset that reads assets from the deck folder", async () => {
    const fx = makeDeck();
    const { deps: d, exportHtml } = deps();
    await runDeckExport(fx.deckUri, "html", d);
    const options = exportHtml.mock.calls[0]![1];
    const bytes = await options.readAsset("assets/pic.png");
    expect(Buffer.from(bytes)).toEqual(PIC);
  });

  it("8.3a saves a dirty deck document before exporting it", async () => {
    const edited = DECK.replace("<img", "<h1>Edited</h1><img");
    const fx = makeDeck({ dirty: edited });
    const { deps: d, exportHtml } = deps();
    await runDeckExport(fx.deckUri, "html", d);
    expect(fx.doc.save).toHaveBeenCalled();
    expect(exportHtml.mock.calls[0]![0]).toBe(edited);
  });

  it("8.3a reports 'Exported <name>.html' with Open and Reveal", async () => {
    const fx = makeDeck();
    const { deps: d } = deps();
    await runDeckExport(fx.deckUri, "html", d);
    await flush();
    const call = infoCall("Exported intro.html");
    expect(call).toBeDefined();
    expect(call).toEqual(expect.arrayContaining(["Open", "Reveal"]));
  });

  it("8.3a Open opens the exported file externally", async () => {
    const fx = makeDeck();
    (vscode.window.showInformationMessage as jest.Mock).mockImplementation(async (message: string) => (String(message).includes("Exported") ? "Open" : undefined));
    const { deps: d } = deps();
    await runDeckExport(fx.deckUri, "html", d);
    await flush();
    expect(vscode.env.openExternal).toHaveBeenCalledWith(expect.objectContaining({ fsPath: path.join(fx.deckDir, "intro.html") }));
  });

  it("8.3a Reveal reveals the exported file in the OS", async () => {
    const fx = makeDeck();
    (vscode.window.showInformationMessage as jest.Mock).mockImplementation(async (message: string) => (String(message).includes("Exported") ? "Reveal" : undefined));
    const { deps: d } = deps();
    await runDeckExport(fx.deckUri, "html", d);
    await flush();
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith("revealFileInOS", expect.objectContaining({ fsPath: path.join(fx.deckDir, "intro.html") }));
  });

  it("8.3a asks 'Replace intro.html?' before overwriting and keeps the file on cancel", async () => {
    const fx = makeDeck();
    const out = path.join(fx.deckDir, "intro.html");
    fs.writeFileSync(out, "OLD");
    const { deps: d } = deps();
    const result = await runDeckExport(fx.deckUri, "html", d);
    const asked = (vscode.window.showWarningMessage as jest.Mock).mock.calls.find((call) => String(call[0]).includes("Replace intro.html?"));
    expect(asked).toBeDefined();
    expect(asked).toEqual(expect.arrayContaining(["Replace"]));
    expect(fs.readFileSync(out, "utf8")).toBe("OLD");
    expect(result).toBeUndefined();
  });

  it("8.3a overwrites the existing file when the user picks Replace", async () => {
    const fx = makeDeck();
    const out = path.join(fx.deckDir, "intro.html");
    fs.writeFileSync(out, "OLD");
    (vscode.window.showWarningMessage as jest.Mock).mockImplementation(async () => "Replace");
    const { deps: d } = deps();
    const result = await runDeckExport(fx.deckUri, "html", d);
    expect(fs.readFileSync(out, "utf8")).toBe("<!doctype html><p>EXPORTED SINGLE FILE</p>");
    expect(result?.fsPath).toBe(out);
  });

  it("8.3a shows 'Export failed: <message>' and logs when the export throws", async () => {
    const fx = makeDeck();
    const { deps: d, logger } = deps({ exportHtml: jest.fn(async () => { throw new Error("The deck has errors: DECK001."); }) as never });
    const result = await runDeckExport(fx.deckUri, "html", d);
    expect(result).toBeUndefined();
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining("Export failed: The deck has errors: DECK001."));
    expect(loggerWasUsed(logger)).toBe(true);
  });
});

describe("Export PDF", () => {
  it("8.3b asks exportDeckPdf for <folder name>.pdf beside the deck under an 'Exporting PDF' notification", async () => {
    const fx = makeDeck();
    const { deps: d, exportPdf } = deps();
    await runDeckExport(fx.deckUri, "pdf", d);
    expect(exportPdf).toHaveBeenCalledTimes(1);
    const options = exportPdf.mock.calls[0]![1];
    expect(options.out).toBe(path.join(fx.deckDir, "intro.pdf"));
    expect(options.logger).toBeDefined();
    expect(vscode.window.withProgress).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Exporting PDF", location: vscode.ProgressLocation.Notification }), expect.any(Function),
    );
  });

  it("8.3b returns the PDF uri and reports 'Exported <name>.pdf' with Open on a pdf result", async () => {
    const fx = makeDeck();
    const { deps: d } = deps();
    const result = await runDeckExport(fx.deckUri, "pdf", d);
    await flush();
    expect(result?.fsPath).toBe(path.join(fx.deckDir, "intro.pdf"));
    const call = infoCall("Exported intro.pdf");
    expect(call).toBeDefined();
    expect(call).toEqual(expect.arrayContaining(["Open"]));
  });

  it("8.3b Open on the PDF message opens the PDF externally", async () => {
    const fx = makeDeck();
    (vscode.window.showInformationMessage as jest.Mock).mockImplementation(async (message: string) => (String(message).includes("Exported") ? "Open" : undefined));
    const { deps: d } = deps();
    await runDeckExport(fx.deckUri, "pdf", d);
    await flush();
    expect(vscode.env.openExternal).toHaveBeenCalledWith(expect.objectContaining({ fsPath: path.join(fx.deckDir, "intro.pdf") }));
  });

  function fallbackDeps(fx: Fixture, overrides: Partial<DeckExportDeps> = {}) {
    const htmlPath = path.join(fx.deckDir, "intro.html");
    const exportPdf = jest.fn(async () => {
      fs.writeFileSync(htmlPath, "<p>print me</p>");
      return { kind: "fallback" as const, htmlPath, message: "No Chromium was found, so the deck opened for printing." };
    });
    return { htmlPath, ...deps({ exportPdf: exportPdf as never, ...overrides }) };
  }

  it("8.3b on fallback opens the HTML with #print and returns undefined", async () => {
    const fx = makeDeck();
    const { deps: d, htmlPath } = fallbackDeps(fx);
    const result = await runDeckExport(fx.deckUri, "pdf", d);
    await flush();
    expect(result).toBeUndefined();
    expect(vscode.env.openExternal).toHaveBeenCalledWith(expect.objectContaining({ fsPath: htmlPath, fragment: "print" }));
  });

  it("8.3b on fallback shows the Chromium message with Install Chromium when a provider is set", async () => {
    const fx = makeDeck();
    const { deps: d } = fallbackDeps(fx, { chromium: chromiumFake({ installed: false }) as never });
    await runDeckExport(fx.deckUri, "pdf", d);
    await flush();
    const call = infoCall("No Chromium was found, so the deck opened for printing.");
    expect(call).toBeDefined();
    expect(call).toEqual(expect.arrayContaining(["Install Chromium"]));
  });

  it("8.3b on fallback offers no Install Chromium without a provider", async () => {
    const fx = makeDeck();
    const { deps: d } = fallbackDeps(fx);
    await runDeckExport(fx.deckUri, "pdf", d);
    await flush();
    const call = infoCall("No Chromium was found, so the deck opened for printing.");
    expect(call).toBeDefined();
    expect(call).not.toContain("Install Chromium");
  });

  it("8.3b Install Chromium runs the provider's install", async () => {
    const fx = makeDeck();
    const chromium = chromiumFake({ installed: false });
    (vscode.window.showInformationMessage as jest.Mock).mockImplementation(async (_message: string, ...items: unknown[]) => (items.includes("Install Chromium") ? "Install Chromium" : undefined));
    const { deps: d } = fallbackDeps(fx, { chromium: chromium as never });
    await runDeckExport(fx.deckUri, "pdf", d);
    await flush();
    expect(chromium.install).toHaveBeenCalled();
  });

  it("8.3b passes a find resolving the managed Chromium when it is installed", async () => {
    const fx = makeDeck();
    const chromium = chromiumFake({ installed: true, version: "1", executable: "/tools/chrome/1/chrome-headless-shell" });
    const { deps: d, exportPdf } = deps({ chromium: chromium as never });
    await runDeckExport(fx.deckUri, "pdf", d);
    const options = exportPdf.mock.calls[0]![1];
    expect(typeof options.find).toBe("function");
    await expect(options.find()).resolves.toEqual({ path: "/tools/chrome/1/chrome-headless-shell", source: "managed" });
  });

  it("8.3b passes no find when the managed Chromium is not installed", async () => {
    const fx = makeDeck();
    const { deps: d, exportPdf } = deps({ chromium: chromiumFake({ installed: false }) as never });
    await runDeckExport(fx.deckUri, "pdf", d);
    expect(exportPdf.mock.calls[0]![1].find).toBeUndefined();
  });

  it("8.3b shows 'Export failed: <message>' when exportDeckPdf throws", async () => {
    const fx = makeDeck();
    const { deps: d, logger } = deps({ exportPdf: jest.fn(async () => { throw new Error("disk full"); }) as never });
    const result = await runDeckExport(fx.deckUri, "pdf", d);
    expect(result).toBeUndefined();
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining("Export failed: disk full"));
    expect(loggerWasUsed(logger)).toBe(true);
  });
});

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { return sourceFiles(full); }
    return /\.(ts|tsx|mts|js|mjs)$/.test(entry.name) ? [full] : [];
  });
}

function importSpecifiers(source: string): string[] {
  const specs: string[] = [];
  const pattern = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)["']([^"']+)["']/g;
  for (let match = pattern.exec(source); match; match = pattern.exec(source)) { specs.push(match[1]!); }
  return specs;
}

describe("wiring", () => {
  it("8.3c registerDeckExport registers labshelf.decks.exportPdf and labshelf.decks.exportHtml", async () => {
    const context = { subscriptions: [] as vscode.Disposable[] };
    const { deps: d, exportHtml } = deps({ chromium: chromiumFake({ installed: false }) as never });
    registerDeckExport(context as never, d);
    const ids = (vscode.commands.registerCommand as jest.Mock).mock.calls.map((call) => call[0]);
    expect(ids).toEqual(expect.arrayContaining(["labshelf.decks.exportPdf", "labshelf.decks.exportHtml"]));
    const fx = makeDeck();
    const handler = (vscode.commands.registerCommand as jest.Mock).mock.calls.find((call) => call[0] === "labshelf.decks.exportHtml")![1];
    await handler(fx.deckUri);
    expect(exportHtml).toHaveBeenCalled();
  });

  it("8.3c registerNodeWriting calls registerDeckExport", () => {
    const source = fs.readFileSync(path.join(srcRoot, "activation/node/desktopPlatform.ts"), "utf8");
    const start = source.indexOf("export const registerNodeWriting");
    expect(start).toBeGreaterThanOrEqual(0);
    const end = source.indexOf("\n};", start);
    const body = source.slice(start, end);
    expect(body).toMatch(/registerDeckExport\s*\(/);
    expect(importSpecifiers(source).some((spec) => /writing\/deckEditor\/node\/exportDeck(\.js)?$/.test(spec))).toBe(true);
  });

  it("8.3c package.json declares the export commands", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(pkgRoot, "package.json"), "utf8"));
    const ids = (manifest.contributes.commands as Array<{ command: string }>).map((entry) => entry.command);
    expect(ids).toEqual(expect.arrayContaining(["labshelf.decks.exportPdf", "labshelf.decks.exportHtml"]));
  });

  it("8.3c no file under src but activation/node/desktopPlatform.ts imports node/exportDeck", () => {
    const target = path.join(srcRoot, "writing/deckEditor/node/exportDeck");
    const importers = sourceFiles(srcRoot).filter((file) => {
      const specs = importSpecifiers(fs.readFileSync(file, "utf8"));
      return specs.some((spec) => {
        if (!spec.startsWith(".")) { return false; }
        const resolved = path.resolve(path.dirname(file), spec).replace(/\.(js|ts|mjs)$/, "");
        return resolved === target;
      });
    }).map((file) => path.relative(srcRoot, file).split(path.sep).join("/"));
    expect(importers).toEqual(["activation/node/desktopPlatform.ts"]);
  });
});
