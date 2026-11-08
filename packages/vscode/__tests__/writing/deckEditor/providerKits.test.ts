// Tests that the HTML deck provider answers the page's kits messages (list, save, pickImage) with a kitsResult of the same id from the shared handler.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";

import { createDeckEditorProvider } from "../../../src/writing/deckEditor/provider";
import type { DeckKitsHandler } from "../../../src/writing/sourceEditor/deckKits";
import { fakeLogger, fakeProjects } from "../../support/writingFixtures";

type Posted = { type: string; [key: string]: unknown };
const flush = async () => { for (let i = 0; i < 10; i++) await new Promise((resolve) => setTimeout(resolve, 0)); };
const KIT = { name: "Lab", style: { primary: "#000000" } };

async function open(kits: DeckKitsHandler) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "deck-kits-provider-"));
  fs.mkdirSync(path.join(dir, "dist", "deckEditor"), { recursive: true });
  fs.writeFileSync(path.join(dir, "dist", "deckEditor", "deckEditor.js"), "");
  const deckPath = path.join(dir, "talk", "deck.html");
  const text = "<!doctype html><html data-deck=\"talk\"><body><section data-slide></section></body></html>";
  const document = { uri: vscode.Uri.file(deckPath), fileName: deckPath, version: 1, isDirty: false, getText: () => text };
  const received: Array<(message: unknown) => void> = [];
  const postMessage = jest.fn(async (_message: unknown) => true);
  const panel = {
    active: false, viewColumn: 1,
    webview: {
      options: {}, html: "", cspSource: "vscode-resource:", postMessage,
      asWebviewUri: (uri: vscode.Uri) => ({ toString: () => `vscode-resource:${uri.fsPath}` }),
      onDidReceiveMessage: (handler: (message: unknown) => void) => { received.push(handler); return { dispose() {} }; },
    },
    onDidDispose: () => ({ dispose() {} }),
    onDidChangeViewState: () => ({ dispose() {} }),
  };
  (vscode.workspace.openTextDocument as jest.Mock).mockRejectedValue(new Error("missing"));
  const provider = createDeckEditorProvider({ extensionUri: vscode.Uri.file(dir), logger: fakeLogger(), projects: fakeProjects([]), kits });
  await provider.resolveCustomTextEditor(document as unknown as vscode.TextDocument, panel as unknown as vscode.WebviewPanel, { isCancellationRequested: false } as vscode.CancellationToken);
  const fromPage = async (message: unknown) => { received.forEach((handler) => handler(message)); await flush(); };
  await fromPage({ type: "ready" });
  const results = (): Posted[] => postMessage.mock.calls.map(([message]) => message as Posted).filter((message) => message.type === "kitsResult");
  return { fromPage, results };
}

function fakeKits(): { [K in keyof DeckKitsHandler]: jest.Mock } {
  return {
    list: jest.fn(async () => [KIT]),
    save: jest.fn(async (kit: unknown) => ({ ...(kit as object), logo: "kits/lab.png" })),
    pickImage: jest.fn(async () => ({ name: "logo.png", base64: "AAEC" })),
  };
}

describe("HTML deck provider: kits", () => {
  it("4b.3c answers list with the handler's kits under the same id", async () => {
    const kits = fakeKits();
    const page = await open(kits);
    await page.fromPage({ type: "kits", id: 7, request: "list" });
    expect(page.results()).toEqual([{ type: "kitsResult", id: 7, ok: true, value: [KIT] }]);
  });

  it("4b.3c answers save with the stored kit, passing the kit and the logo through", async () => {
    const kits = fakeKits();
    const page = await open(kits);
    const logo = { name: "logo.png", base64: "AAEC" };
    await page.fromPage({ type: "kits", id: 2, request: "save", kit: KIT, logo });
    expect(kits.save).toHaveBeenCalledWith(KIT, logo);
    expect(page.results()).toEqual([{ type: "kitsResult", id: 2, ok: true, value: { ...KIT, logo: "kits/lab.png" } }]);
  });

  it("4b.3c answers pickImage with the picked image, and null when cancelled", async () => {
    const kits = fakeKits();
    const page = await open(kits);
    await page.fromPage({ type: "kits", id: 3, request: "pickImage" });
    kits.pickImage.mockResolvedValueOnce(null);
    await page.fromPage({ type: "kits", id: 4, request: "pickImage" });
    expect(page.results()).toEqual([
      { type: "kitsResult", id: 3, ok: true, value: { name: "logo.png", base64: "AAEC" } },
      { type: "kitsResult", id: 4, ok: true, value: null },
    ]);
  });

  it("4b.3c answers a failed request with ok false and the error under the same id", async () => {
    const kits = fakeKits();
    kits.save.mockRejectedValue(new Error("Open a LabShelf library to save kits."));
    const page = await open(kits);
    await page.fromPage({ type: "kits", id: 5, request: "save", kit: KIT });
    expect(page.results()).toEqual([{ type: "kitsResult", id: 5, ok: false, error: "Open a LabShelf library to save kits." }]);
  });
});
