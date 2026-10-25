// Tests manual Checklist items end to end against a real .labshelf/checklist.json.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";

import { addManualItem, readManualItems, updateChecklist } from "@labshelf/core";
import { createNodeProjectReadCompositionRoot } from "@labshelf/core/node";
import { ChecklistView } from "../../../src/writing/checklist";
import type { ReadyProject } from "../../../src/writing/figures";
import { fakeLogger, readyEntry } from "../../support/writingFixtures";

const flush = () => new Promise((resolve) => setImmediate(resolve));
let folder: string;
const file = () => path.join(folder, ".labshelf", "checklist.json");
const onDisk = () => JSON.parse(fs.readFileSync(file(), "utf8")).items as Array<{ id: string; text: string; done: boolean }>;

function setup(initial?: string) {
  if (initial !== undefined) {
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    fs.writeFileSync(file(), initial);
  }
  const project = readyEntry(folder) as ReadyProject;
  const changed = new vscode.EventEmitter<void>();
  const logger = fakeLogger();
  const signals = {
    current: undefined as unknown,
    onDidChange: changed.event,
    refresh: jest.fn(async () => {
      signals.current = { project, signals: { sources: [], todos: [], brokenRefs: [], staleFigures: [], manual: await readManualItems(createNodeProjectReadCompositionRoot(logger), folder) }, pageOverflow: undefined, pageCount: undefined };
      changed.fire();
    }),
  };
  // TRAP: the first refresh reads checklist.json from disk, which takes more than one event-loop turn.
  const ready = signals.refresh();
  const reading = { of: jest.fn(async () => ({ entries: [], neverOpened: 0 })), onDidChange: new vscode.EventEmitter<void>().event };
  const view = new ChecklistView({
    paths: path, signals: signals as never, reading, memory: { get: () => undefined, update: async () => {}, keys: () => [] }, setStatus: async () => [],
    updateChecklist: (target, edit) => updateChecklist(createNodeProjectReadCompositionRoot(logger), target, edit), logger, newId: () => "item-1", now: () => new Date("2026-05-01T10:00:00Z"),
  });
  return { view, logger, signals, ready };
}

const manualRows = (view: ChecklistView) => view.nodes().find((node) => node.label === "My items")?.children ?? [];

beforeEach(() => {
  jest.clearAllMocks();
  folder = fs.mkdtempSync(path.join(os.tmpdir(), "checklist-view-"));
});
afterEach(() => fs.rmSync(folder, { recursive: true, force: true }));

describe("ChecklistView: manual items", () => {
  it("writes an added item to checklist.json and shows it open", async () => {
    const { view } = setup();
    (vscode.window.showInputBox as jest.Mock).mockResolvedValueOnce("Thank reviewers");
    await view.addItem();
    await flush();
    expect(onDisk()).toEqual([expect.objectContaining({ id: "item-1", text: "Thank reviewers", done: false })]);
    expect(manualRows(view)[0]).toEqual(expect.objectContaining({ label: "Thank reviewers", checked: false }));
  });

  it("writes nothing when the input box is cancelled", async () => {
    const { view } = setup();
    (vscode.window.showInputBox as jest.Mock).mockResolvedValueOnce(undefined);
    await view.addItem();
    expect(fs.existsSync(file())).toBe(false);
  });

  it("toggles an item done and open on disk through its checkbox", async () => {
    const seed = JSON.stringify(addManualItem({ items: [] }, { id: "m1", text: "Cite more", now: "2026-04-01T00:00:00.000Z" }));
    const { view, ready } = setup(seed);
    await ready;
    await view.handle({ op: "check", key: manualRows(view)[0]!.key, checked: true });
    await flush();
    expect(onDisk()[0]).toEqual(expect.objectContaining({ id: "m1", done: true, doneAt: "2026-05-01T10:00:00.000Z" }));
    await view.handle({ op: "check", key: manualRows(view)[0]!.key, checked: false });
    expect(onDisk()[0]).toEqual(expect.objectContaining({ id: "m1", done: false }));
  });

  it("deletes an item from disk", async () => {
    const seed = JSON.stringify(addManualItem({ items: [] }, { id: "m1", text: "Cite more", now: "2026-04-01T00:00:00.000Z" }));
    const { view, ready } = setup(seed);
    await ready;
    await view.handle({ op: "menu", key: manualRows(view)[0]!.key, action: "removeItem" });
    expect(onDisk()).toEqual([]);
  });

  it("shows an error, logs and leaves a malformed checklist.json unchanged on add", async () => {
    const { view, logger } = setup("{ not json");
    (vscode.window.showInputBox as jest.Mock).mockResolvedValueOnce("Thank reviewers");
    await view.addItem();
    expect(vscode.window.showErrorMessage).toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalled();
    expect(fs.readFileSync(file(), "utf8")).toBe("{ not json");
  });
});
