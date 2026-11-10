// "Insert into Manuscript…" from a code file: the reader's cite popup in a small webview panel, inserting a linked listing instead of a citation.
// The panel answers the popup's cite requests with answerManuscriptInsert over the reader's cite IO (open documents, WorkspaceEdit, stale refusal).
import * as vscode from "vscode";

import { answerManuscriptInsert, createNonce, isRecord, type CiteRequest, type ManuscriptInsert } from "@labshelf/core";
import { createReaderCiteIo, type ReaderCiteDeps } from "../../reader/index.js";
import { createTabIcon, hasBundleFile, renderBundleMissingHtml, renderHtmlShell, webviewChunksDir } from "../../ui/index.js";

/** What the panel's page posts; `cite` requests follow the reader protocol. */
type PageMessage =
  | { command: "ready" }
  | { command: "cite"; requestId: string; request: CiteRequest }
  | { command: "copyText"; text: string }
  | { command: "notice"; message: string }
  | { command: "close"; projectId?: string; path?: string };

/** What the host posts to the page before it opens the popup. */
interface CodeInsertBoot { type: "codeInsert.boot"; label: string; memory: { projectId?: string; path?: string } }

export interface CodeInsertPanelDeps extends ReaderCiteDeps {
  /** Refreshes the marks of a native manuscript after an insert. */
  inserted(uri: vscode.Uri): void;
}

const TITLE = "Insert into Manuscript";

/** The project and file last picked, so the next insert starts there. */
const memory: { projectId?: string; path?: string } = {};
let current: vscode.WebviewPanel | undefined;

const bundleDir = (extensionUri: vscode.Uri): vscode.Uri => vscode.Uri.joinPath(extensionUri, "dist", "codeInsert");

async function renderPage(webview: vscode.Webview, extensionUri: vscode.Uri): Promise<string> {
  const script = vscode.Uri.joinPath(bundleDir(extensionUri), "codeInsert.js");
  if (!(await hasBundleFile(script))) {
    return renderBundleMissingHtml({ title: TITLE, heading: "Insert into Manuscript bundle not built", file: "dist/codeInsert/codeInsert.js", reopen: "Insert into Manuscript" });
  }
  return renderHtmlShell({
    nonce: createNonce(), cspSource: webview.cspSource, title: TITLE,
    stylesheetUrl: webview.asWebviewUri(vscode.Uri.joinPath(bundleDir(extensionUri), "codeInsert.css")).toString(),
    scriptUrl: webview.asWebviewUri(script).toString(),
  });
}

function readMessage(raw: unknown): PageMessage | undefined {
  if (!isRecord(raw) || typeof raw["command"] !== "string") { return undefined; }
  return raw as PageMessage;
}

/**
 * Opens the popup for `subject`, replacing one already open.
 * @param preferredProjectId the project that holds the code file; the popup otherwise starts at the last one picked
 */
export async function openCodeInsertPanel(
  extensionUri: vscode.Uri, deps: CodeInsertPanelDeps, subject: Extract<ManuscriptInsert, { kind: "code" }>, label: string, preferredProjectId: string | undefined,
): Promise<void> {
  current?.dispose();
  const panel = vscode.window.createWebviewPanel("labshelfCodeInsert", TITLE, vscode.ViewColumn.Beside, {
    enableScripts: true, localResourceRoots: [bundleDir(extensionUri), webviewChunksDir(extensionUri)],
  });
  current = panel;
  panel.iconPath = createTabIcon(extensionUri);
  panel.onDidDispose(() => { if (current === panel) { current = undefined; } });
  const io = createReaderCiteIo(deps);
  const start = preferredProjectId !== undefined && preferredProjectId !== memory.projectId ? { projectId: preferredProjectId } : { ...memory };
  panel.webview.onDidReceiveMessage(async (raw: unknown) => {
    const message = readMessage(raw);
    switch (message?.command) {
      case "ready": {
        const boot: CodeInsertBoot = { type: "codeInsert.boot", label, memory: start };
        await panel.webview.postMessage(boot);
        return;
      }
      case "cite": {
        const reply = await answerManuscriptInsert(io, subject, message.request);
        if (reply.kind === "inserted" && message.request.kind === "insert") { notifyInserted(deps, message.request.projectId, reply.path); }
        await panel.webview.postMessage({ type: "cite.reply", requestId: message.requestId, reply });
        return;
      }
      case "copyText":
        await vscode.env.clipboard.writeText(message.text);
        void vscode.window.showInformationMessage("Listing copied");
        return;
      case "notice":
        void vscode.window.showInformationMessage(message.message);
        return;
      case "close":
        if (message.projectId !== undefined) { memory.projectId = message.projectId; }
        if (message.path !== undefined) { memory.path = message.path; }
        panel.dispose();
        return;
      default:
        return;
    }
  });
  panel.webview.html = await renderPage(panel.webview, extensionUri);
}

function notifyInserted(deps: CodeInsertPanelDeps, projectId: string, path: string): void {
  const project = deps.projects.list().find((entry) => entry.kind === "ready" && entry.settings.id === projectId);
  if (project?.kind === "ready") { deps.inserted(vscode.Uri.file(deps.projects.paths.join(project.folder, ...path.split("/")))); }
}
