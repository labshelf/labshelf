/** The img-src part of a webview CSP: one helper builds it, the HTML shell and the Spaces shell splice it in. */
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { cspImageSource } from "../../src/ui/cspImages";
import { renderHtmlShell } from "../../src/ui/htmlShell";
import type { SpacesService } from "../../src/spaces/view";
import { registerSpacesPanels } from "../../src/spaces/spacesPanels";

jest.mock("@labshelf/core", () => ({ ...jest.requireActual("@labshelf/core"), serveSpaces: jest.fn(() => jest.fn()) }));

const base = { nonce: "N", cspSource: "SRC", title: "T", stylesheetUrl: "css-url", scriptUrl: "js-url" };
/** The `images` option is typed by the implementation; the cast keeps this file compiling before it exists. */
const shell = (images?: string): string => renderHtmlShell((images === undefined ? base : { ...base, images }) as Parameters<typeof renderHtmlShell>[0]);
const flush = () => new Promise(resolve => setImmediate(resolve));
const cspOf = (html: string): string => /http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(html)![1]!;

describe("cspImages", () => {
  // Every test reaches the seam first.
  beforeEach(() => {
    cspImageSource("x", "none");
  });

  test("1.1a none adds no img-src directive", () => {
    expect(cspImageSource("SRC", "none")).toBe("");
  });

  test("1.1a data allows the extension and data: images, with a leading space and a trailing semicolon", () => {
    expect(cspImageSource("SRC", "data")).toBe(" img-src SRC data:;");
  });

  test("1.1a qmd allows the extension, data: and blob: images", () => {
    expect(cspImageSource("SRC", "qmd")).toBe(" img-src SRC data: blob:;");
  });

  test("1.1a the source it gets is used as given", () => {
    expect(cspImageSource("vscode-resource:", "qmd")).toBe(" img-src vscode-resource: data: blob:;");
  });

  test("1.1a renderHtmlShell leaves the CSP unchanged when no images option is given", () => {
    const csp = cspOf(shell());
    expect(csp).toBe("default-src 'none'; script-src 'nonce-N' SRC; style-src 'nonce-N' SRC; font-src SRC;");
    expect(csp).not.toContain("img-src");
  });

  test("1.1a renderHtmlShell with images none has no img-src", () => {
    expect(cspOf(shell("none"))).not.toContain("img-src");
  });

  test("1.1a renderHtmlShell with images data allows data: but not blob:", () => {
    const csp = cspOf(shell("data"));
    expect(csp).toBe("default-src 'none'; script-src 'nonce-N' SRC; style-src 'nonce-N' SRC; img-src SRC data:; font-src SRC;");
    expect(csp).not.toContain("blob:");
  });

  test("1.1a renderHtmlShell with images qmd allows the extension, data: and blob: images", () => {
    expect(cspOf(shell("qmd")))
      .toBe("default-src 'none'; script-src 'nonce-N' SRC; style-src 'nonce-N' SRC; img-src SRC data: blob:; font-src SRC;");
  });

  test("1.1a the Spaces webview CSP allows the extension, data: and blob: images", async () => {
    jest.clearAllMocks();
    (vscode.workspace.fs.stat as jest.Mock).mockResolvedValue({});
    const context = { extensionUri: vscode.Uri.file("/ext"), subscriptions: [] as vscode.Disposable[] } as vscode.ExtensionContext;
    const change = new vscode.EventEmitter<void>();
    const current = { store: { list: () => [], onChange: () => () => {} }, port: {}, logger: { log: jest.fn() } };
    const source = registerSpacesPanels(context, { current: () => current, onDidChange: change.event } as unknown as SpacesService);
    (vscode.commands.registerCommand as jest.Mock).mock.calls.find(([name]) => name === "labshelf.spaces.all")![1]();
    await flush();
    const panel = (vscode.window.createWebviewPanel as jest.Mock).mock.results[0]!.value;
    const csp = cspOf(panel.webview.html);
    expect(csp).toContain(` img-src ${panel.webview.cspSource} data: blob:;`);
    expect(csp).toContain(`style-src 'nonce-`);
    expect(csp).toContain(`font-src ${panel.webview.cspSource};`);
    source.dispose();
  });

  test("A3 toimage-spike.md records png, svg and colour bar results per host and the decision", () => {
    let dir = __dirname;
    while (!fs.existsSync(path.join(dir, "documents", "plans", "charts", "research")) && path.dirname(dir) !== dir) dir = path.dirname(dir);
    const file = path.join(dir, "documents", "plans", "charts", "research", "toimage-spike.md");
    expect(fs.existsSync(file)).toBe(true);
    const text = fs.readFileSync(file, "utf8").toLowerCase();
    for (const host of ["source editor", "spaces", "reader", "browser"]) expect(text).toContain(host);
    for (const word of ["png", "svg"]) expect(text).toContain(word);
    expect(/colou?r ?bar/.test(text)).toBe(true);
    expect(text).toContain("decision");
  });
});
