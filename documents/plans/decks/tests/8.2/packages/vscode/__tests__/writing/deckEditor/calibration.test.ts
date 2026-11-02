// Tests the poster calibration store: kept in globalState under labshelf.decks.calibration, never registered for sync, invalid stored values ignored.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";

import { createGlobalCalibrationStore } from "../../../src/writing/deckEditor/calibration";
import { registerDeckCommands } from "../../../src/writing/deckEditor/commands";
import { commandHandler, fakeLogger, fakeProjects, readyEntry } from "../../support/writingFixtures";

const KEY = "labshelf.decks.calibration";

/** A Map-backed Memento with a recording setKeysForSync, as context.globalState is. */
function fakeMemento(initial: Record<string, unknown> = {}) {
  const values = new Map<string, unknown>(Object.entries(initial));
  return {
    values,
    get: jest.fn((key: string, fallback?: unknown) => (values.has(key) ? values.get(key) : fallback)),
    update: jest.fn(async (key: string, value: unknown) => {
      if (value === undefined) { values.delete(key); } else { values.set(key, value); }
    }),
    keys: jest.fn(() => [...values.keys()]),
    setKeysForSync: jest.fn(),
  };
}

const syncedKeys = (memento: ReturnType<typeof fakeMemento>): string[] => memento.setKeysForSync.mock.calls.flatMap(([keys]) => [...(keys as string[])]);

describe("createGlobalCalibrationStore", () => {
  it("8.2d saves the calibration in globalState under labshelf.decks.calibration", async () => {
    const memento = fakeMemento();
    const store = createGlobalCalibrationStore(memento as never);
    await store.save({ pxPerMm: 3.78, measuredAt: "2026-11-02T10:00:00.000Z" });
    expect(memento.update).toHaveBeenCalledWith(KEY, { pxPerMm: 3.78, measuredAt: "2026-11-02T10:00:00.000Z" });
  });

  it("8.2d loads a saved calibration back", async () => {
    const memento = fakeMemento();
    await createGlobalCalibrationStore(memento as never).save({ pxPerMm: 4.2, measuredAt: "2026-11-01T08:30:00.000Z" });
    await expect(createGlobalCalibrationStore(memento as never).load()).resolves.toEqual({ pxPerMm: 4.2, measuredAt: "2026-11-01T08:30:00.000Z" });
  });

  it("8.2d loads a value already stored under the key", async () => {
    const memento = fakeMemento({ [KEY]: { pxPerMm: 3.5, measuredAt: "2026-10-01T00:00:00.000Z" } });
    await expect(createGlobalCalibrationStore(memento as never).load()).resolves.toEqual({ pxPerMm: 3.5, measuredAt: "2026-10-01T00:00:00.000Z" });
  });

  it("8.2d loads nothing when no calibration is stored", async () => {
    await expect(createGlobalCalibrationStore(fakeMemento() as never).load()).resolves.toBeUndefined();
  });

  it.each([
    ["zero", { pxPerMm: 0, measuredAt: "2026-10-01T00:00:00.000Z" }],
    ["negative", { pxPerMm: -3, measuredAt: "2026-10-01T00:00:00.000Z" }],
    ["NaN", { pxPerMm: Number.NaN, measuredAt: "2026-10-01T00:00:00.000Z" }],
    ["infinite", { pxPerMm: Number.POSITIVE_INFINITY, measuredAt: "2026-10-01T00:00:00.000Z" }],
    ["a string", { pxPerMm: "3.7", measuredAt: "2026-10-01T00:00:00.000Z" }],
    ["missing", { measuredAt: "2026-10-01T00:00:00.000Z" }],
    ["null pxPerMm", { pxPerMm: null, measuredAt: "2026-10-01T00:00:00.000Z" }],
    ["a bare number", 3.7],
    ["a string value", "3.7"],
    ["null", null],
  ])("8.2d ignores a stored pxPerMm that is %s", async (_label, stored) => {
    const memento = fakeMemento({ [KEY]: stored });
    await expect(createGlobalCalibrationStore(memento as never).load()).resolves.toBeUndefined();
  });

  it("8.2d never registers the calibration key for sync", async () => {
    const memento = fakeMemento();
    const store = createGlobalCalibrationStore(memento as never);
    await store.save({ pxPerMm: 3.78, measuredAt: "2026-11-02T10:00:00.000Z" });
    await store.load();
    expect(syncedKeys(memento)).not.toContain(KEY);
  });
});

describe("Poster Preview calibration storage", () => {
  let projectDir: string;

  beforeEach(() => {
    jest.clearAllMocks();
    (vscode.workspace.fs.readFile as jest.Mock).mockImplementation(async (uri: vscode.Uri) => Buffer.from(fs.readFileSync(uri.fsPath)));
    (vscode.workspace.fs.stat as jest.Mock).mockImplementation(async (uri: vscode.Uri) => {
      const stat = fs.statSync(uri.fsPath, { throwIfNoEntry: false });
      if (!stat) { throw Object.assign(new Error(`ENOENT: ${uri.fsPath}`), { code: "FileNotFound" }); }
      return { type: stat.isDirectory() ? vscode.FileType.Directory : vscode.FileType.File, ctime: 0, mtime: 0, size: stat.size };
    });
    (vscode.commands.executeCommand as jest.Mock).mockImplementation(async () => undefined);
    projectDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "labshelf-poster-")));
  });

  afterEach(() => fs.rmSync(projectDir, { recursive: true, force: true }));

  it("8.2d registering the deck commands and opening Poster Preview never registers the calibration key for sync", async () => {
    const folder = path.join(projectDir, "posters", "big");
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, "deck.html"), '<!doctype html>\n<html lang="en" data-deck="poster" data-deck-version="1" data-deck-size="841x1189mm">\n<head><meta charset="utf-8"><title>big</title><link rel="stylesheet" href="theme.css" data-deck-theme></head>\n<body><section data-slide></section></body>\n</html>\n');
    fs.writeFileSync(path.join(folder, "theme.css"), ":root {}\n");
    const globalState = fakeMemento();
    const deps = { extensionUri: vscode.Uri.file("/ext"), projects: fakeProjects([readyEntry(projectDir)]) as never, logger: fakeLogger() };
    registerDeckCommands({ subscriptions: [], extensionUri: deps.extensionUri, globalState } as unknown as vscode.ExtensionContext, deps);
    await commandHandler("labshelf.decks.posterPreview")(vscode.Uri.file(path.join(folder, "deck.html")));
    expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(1);
    expect(syncedKeys(globalState)).not.toContain(KEY);
  });
});
