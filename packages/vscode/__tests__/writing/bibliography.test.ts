// Tests that .bib documents get the linter's diagnostics on open and save, and that quick fixes follow the lint they came from.
import * as vscode from "vscode";

import { BIBLIOGRAPHY_HEADER, createPublishedVersionFinder, type RegistryEnv } from "@labshelf/core";
import {
  BibCodeActions,
  registerBibliographyLint,
  BibDiagnostics,
} from "../../src/writing/registerBibliographyCheck";

const ARXIV = "https://export.arxiv.org/api/query?id_list=1706.03762";
const PUBLISHED_DOI = "10.5555/3295222.3295349";
const crossref = (doi: string): string => `https://api.crossref.org/works/${encodeURIComponent(doi)}`;
const feed = `<feed><entry><id>http://arxiv.org/abs/1706.03762v7</id><title>T</title><arxiv:doi>${PUBLISHED_DOI}</arxiv:doi></entry></feed>`;
const PUBLISHED = {
  message: {
    type: "proceedings-article", title: ["Attention is All you Need"], author: [{ given: "Ashish", family: "Vaswani" }],
    issued: { "date-parts": [[2017]] }, "container-title": ["NeurIPS"], page: "5998-6008", DOI: PUBLISHED_DOI,
  },
};
const SEARCH = "https://api.crossref.org/works?rows=3&query.bibliographic=" + encodeURIComponent("Deep Residual Learning He, Kaiming");

function fakeEnv(routes: Record<string, string | object>, calls: string[] = []): RegistryEnv {
  const fetchFake = async (input: string | URL): Promise<Response> => {
    calls.push(String(input));
    const body = routes[String(input)];
    return body === undefined ? new Response("no", { status: 404 }) : new Response(typeof body === "string" ? body : JSON.stringify(body));
  };
  return { fetch: fetchFake as typeof fetch };
}

const workspace = vscode.workspace as unknown as { _fireDocumentEvent: (kind: string, doc: unknown) => void; textDocuments: unknown[] };

function bibDocument(text: string, path = "/lib/refs.bib") {
  const document = {
    uri: vscode.Uri.file(path), version: 1, isClosed: false, text,
    getText: () => document.text,
    positionAt: (offset: number) => new vscode.Position(0, offset),
    offsetAt: (position: vscode.Position) => position.character,
  };
  return document;
}
type FakeDocument = ReturnType<typeof bibDocument>;

const asDocument = (document: FakeDocument): vscode.TextDocument => document as unknown as vscode.TextDocument;
const lastCollection = () => (vscode.languages.createDiagnosticCollection as jest.Mock).mock.results.at(-1)!.value as { set: jest.Mock; delete: jest.Mock };
const settle = async (): Promise<void> => { for (let i = 0; i < 10; i++) { await Promise.resolve(); } await new Promise((resolve) => setImmediate(resolve)); };

const PREPRINT = "@misc{vaswani, title = {Attention}, eprint = {1706.03762}, archivePrefix = {arXiv}}";
const PUBLISHED_ROUTES = { [ARXIV]: feed, [crossref(PUBLISHED_DOI)]: PUBLISHED };
const NO_DOI = "@article{x,\n  title = {Deep Residual Learning},\n  author = {He, Kaiming},\n  year = {2016}\n}";

afterEach(() => { workspace.textDocuments = []; jest.clearAllMocks(); });

function setup(routes: Record<string, string | object> = {}) {
  const env = fakeEnv(routes);
  const logger = { error: jest.fn(async () => {}) };
  const diagnostics = new BibDiagnostics(createPublishedVersionFinder(env), () => logger as never);
  const actions = new BibCodeActions(diagnostics, env, () => logger as never);
  return { diagnostics, actions, logger, collection: lastCollection() };
}

describe("BibDiagnostics", () => {
  it("publishes findings with range, severity, source and code when a .bib opens", async () => {
    const { collection } = setup(PUBLISHED_ROUTES);
    const document = bibDocument(`${PREPRINT}\n@article{x, title = {X}}`);
    workspace._fireDocumentEvent("open", document);
    await settle();
    const [uri, diagnostics] = collection.set.mock.calls[0] as [vscode.Uri, vscode.Diagnostic[]];
    expect(uri).toBe(document.uri);
    expect(diagnostics.map((d) => [d.code, d.severity, d.source, d.range.start.character, d.range.end.character])).toEqual([
      ["published-version", vscode.DiagnosticSeverity.Warning, "LabShelf", 0, PREPRINT.length],
      ["missing-doi", vscode.DiagnosticSeverity.Information, "LabShelf", PREPRINT.length + 1, PREPRINT.length + 1 + 24],
    ]);
  });

  it("lints documents that are already open", async () => {
    const document = bibDocument(NO_DOI);
    workspace.textDocuments = [document];
    const { collection } = setup();
    await settle();
    expect(collection.set).toHaveBeenCalledTimes(1);
  });

  it("lints again on save and ignores other files and the generated bibliography", async () => {
    const { collection } = setup();
    const document = bibDocument(NO_DOI);
    workspace._fireDocumentEvent("open", document);
    await settle();
    document.text = "@article{x, title = {A}, doi = {10.1/a}}";
    document.version = 2;
    workspace._fireDocumentEvent("save", document);
    await settle();
    expect(collection.set.mock.calls.map(([, list]) => list.length)).toEqual([1, 0]);

    workspace._fireDocumentEvent("open", bibDocument(NO_DOI, "/lib/notes.tex"));
    workspace._fireDocumentEvent("open", bibDocument(`${BIBLIOGRAPHY_HEADER}\n\n${NO_DOI}`, "/lib/labshelf.bib"));
    await settle();
    expect(collection.set).toHaveBeenCalledTimes(3);
    expect(collection.set.mock.calls[2][1]).toEqual([]);
  });

  it("clears the diagnostics of a closed document", async () => {
    const { collection } = setup();
    const document = bibDocument(NO_DOI);
    workspace._fireDocumentEvent("open", document);
    await settle();
    workspace._fireDocumentEvent("close", document);
    expect(collection.delete).toHaveBeenCalledWith(document.uri);
  });

  it("logs a failed lint instead of swallowing it", async () => {
    const { logger } = setup();
    const document = bibDocument(NO_DOI);
    document.getText = () => { throw new Error("boom"); };
    workspace._fireDocumentEvent("open", document);
    await settle();
    expect(logger.error).toHaveBeenCalledWith("writing/bibliography", expect.any(Error), { file: "/lib/refs.bib", action: "lint" });
  });
});

describe("BibCodeActions", () => {
  async function linted(text: string, routes: Record<string, string | object>) {
    const setupResult = setup(routes);
    const document = bibDocument(text);
    workspace._fireDocumentEvent("open", document);
    await settle();
    const [, diagnostics] = setupResult.collection.set.mock.calls[0] as [vscode.Uri, vscode.Diagnostic[]];
    const context = { diagnostics, triggerKind: 1, only: undefined } as unknown as vscode.CodeActionContext;
    return { ...setupResult, document, diagnostics, context };
  }

  it("turns a published-version fix into a preferred replace edit", async () => {
    const { actions, document, context } = await linted(PREPRINT, PUBLISHED_ROUTES);
    const [action] = actions.provideCodeActions(asDocument(document), new vscode.Range(0, 0, 0, 0), context);
    expect(action!.kind).toBe(vscode.CodeActionKind.QuickFix);
    expect(action!.isPreferred).toBe(true);
    const [replacement] = (action!.edit as unknown as { replacements: { range: vscode.Range; text: string }[] }).replacements;
    expect([replacement!.range.start.character, replacement!.range.end.character]).toEqual([0, PREPRINT.length]);
    expect(replacement!.text).toContain(PUBLISHED_DOI);
  });

  it("offers nothing once the document changed since the lint", async () => {
    const { actions, document, context } = await linted(PREPRINT, PUBLISHED_ROUTES);
    document.version = 2;
    expect(actions.provideCodeActions(asDocument(document), new vscode.Range(0, 0, 0, 0), context)).toEqual([]);
  });

  it("computes the DOI edit only when the look-up action resolves", async () => {
    const calls: string[] = [];
    const env = fakeEnv({ [SEARCH]: { message: { items: [{ title: ["Deep Residual Learning"], DOI: "10.1109/cvpr.2016.90", issued: { "date-parts": [[2016]] } }] } } }, calls);
    const diagnostics = new BibDiagnostics(createPublishedVersionFinder(env), () => undefined);
    const actions = new BibCodeActions(diagnostics, env, () => undefined);
    const document = bibDocument(NO_DOI);
    workspace._fireDocumentEvent("open", document);
    await settle();
    const [, published] = lastCollection().set.mock.calls[0] as [vscode.Uri, vscode.Diagnostic[]];
    const [action] = actions.provideCodeActions(asDocument(document), new vscode.Range(0, 0, 0, 0), { diagnostics: published } as unknown as vscode.CodeActionContext);
    expect(action!.title).toBe("Look up the DOI");
    expect(action!.edit).toBeUndefined();
    expect(calls).toEqual([]);

    const resolved = await actions.resolveCodeAction(action!);
    const [replacement] = (resolved.edit as unknown as { replacements: { text: string }[] }).replacements;
    expect(replacement!.text).toBe("\n  doi = {10.1109/cvpr.2016.90},");
  });

  it("tells the user when no DOI is found", async () => {
    const { actions, document, context } = await linted(NO_DOI, {});
    const [action] = actions.provideCodeActions(asDocument(document), new vscode.Range(0, 0, 0, 0), context);
    const resolved = await actions.resolveCodeAction(action!);
    expect(resolved.edit).toBeUndefined();
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith("No DOI found for x.");
  });
});

describe("registerBibliographyLint", () => {
  it("registers a quick-fix provider for .bib files and disposes with the extension", () => {
    const context = { subscriptions: [] as { dispose(): void }[] } as unknown as vscode.ExtensionContext;
    registerBibliographyLint(context, { logger: () => undefined });
    expect(vscode.languages.registerCodeActionsProvider).toHaveBeenCalledWith(
      { pattern: "**/*.bib" }, expect.any(BibCodeActions), { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] },
    );
    expect(context.subscriptions).toHaveLength(2);
  });
});
