// Tests that the Writing views register exactly the commands package.json contributes and reloads when the library root changes.
import * as path from "node:path";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as vscode from "vscode";

import { NodeLibraryFileSystem } from "@labshelf/core/node";
import { registerWritingView } from "../../../src/activation/registration/registerWritingView";
import type { LibraryRootController } from "../../../src/activation/libraryLifecycle";
import type { RegisterPlatformWriting } from "../../../src/writing/platformPort";
import { registerNodeWriting } from "../../../src/writing/node";
import { registerWebWriting } from "../../../src/writing/web";
import { fakeLogger, fakeProjectData } from "../../support/writingFixtures";

const manifest = JSON.parse(readFileSync(join(__dirname, "../../../package.json"), "utf8")) as {
  contributes: { commands: { command: string; enablement?: string }[]; menus: Record<string, { command: string; when?: string }[]> & { commandPalette: { command: string; when?: string }[] }; views: { labshelfContainer: { id: string }[] } };
};

/** Commands enabled only off the web: the ones only the desktop registers. */
function desktopOnlyCommands(): Set<string> {
  return new Set(manifest.contributes.commands.filter((entry) => entry.enablement?.includes("!isWeb")).map((entry) => entry.command));
}

const builders = { latex: { request: jest.fn() }, typst: { request: jest.fn() } };
const fakeRegisterWriting: RegisterPlatformWriting = () => ({ builders, history: { recordVersion: jest.fn() } });
const pdfjs = { load: jest.fn(), getDocument: jest.fn() };

function setup(root: string | undefined, register: RegisterPlatformWriting = fakeRegisterWriting, convertDocument: (() => Promise<void>) | null = jest.fn()) {
  const data = fakeProjectData();
  const emitter = new vscode.EventEmitter<{ root: vscode.Uri }>();
  const controller = {
    currentRoot: () => (root ? vscode.Uri.file(root) : undefined),
    currentServices: () => (root ? { logger: fakeLogger() } : null),
    onDidChangeRoot: emitter.event,
    require: jest.fn(async () => null),
  } as unknown as LibraryRootController;
  const context = {
    subscriptions: [],
    globalStorageUri: vscode.Uri.file("/storage"),
    extension: { packageJSON: { version: "0.0.0" } },
    workspaceState: { get: () => undefined, update: jest.fn(async () => {}) },
  };
  const adapters = {
    paths: path, fs: new NodeLibraryFileSystem(), createProjectData: () => data, deviceLayout: () => { throw new Error("The fake project data reads no device dirs"); },
    reader: { locatePdfjs: () => null, isMac: false }, pdfjs, ...(convertDocument ? { convertDocument } : {}),
  };
  registerWritingView(context as unknown as vscode.ExtensionContext, controller, adapters, register);
  return { emitter, listProjects: data.listProjects };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

beforeEach(() => jest.clearAllMocks());

describe("registerWritingView", () => {
  it("registers every labshelf.writing command of package.json and no other", () => {
    setup("/lib", registerNodeWriting);
    const registered = (vscode.commands.registerCommand as jest.Mock).mock.calls.map(([id]) => id as string).filter((id) => id.startsWith("labshelf.writing.")).sort();
    const contributed = manifest.contributes.commands.map((c) => c.command).filter((id) => id.startsWith("labshelf.writing.")).sort();
    expect(registered).toEqual(contributed);
  });

  it("on the web, registers every labshelf.writing command except the ones the manifest enables only off the web", () => {
    setup("/lib", registerWebWriting, null);
    const registered = (vscode.commands.registerCommand as jest.Mock).mock.calls.map(([id]) => id as string).filter((id) => id.startsWith("labshelf.writing.")).sort();
    const desktopOnly = desktopOnlyCommands();
    const contributed = manifest.contributes.commands.map((c) => c.command).filter((id) => id.startsWith("labshelf.writing.") && !desktopOnly.has(id)).sort();
    expect(registered).toEqual(contributed);
    expect([...desktopOnly]).toEqual(expect.arrayContaining(["labshelf.writing.exportWord", "labshelf.writing.compareVersions"]));
  });

  it("hides each desktop-only command on the web in the palette and every menu that shows it", () => {
    const desktopOnly = desktopOnlyCommands();
    const entries = Object.values(manifest.contributes.menus).flat().filter((entry) => desktopOnly.has(entry.command));
    for (const entry of entries.filter((candidate) => candidate.when !== "false")) {
      expect({ command: entry.command, when: entry.when }).toEqual({ command: entry.command, when: expect.stringContaining("!isWeb") });
    }
    const inPalette = new Set(manifest.contributes.menus.commandPalette.map((entry) => entry.command));
    expect([...desktopOnly].filter((command) => !inPalette.has(command))).toEqual([]);
  });

  it("creates the contributed Figures tree view", () => {
    setup("/lib");
    const created = (vscode.window.createTreeView as jest.Mock).mock.calls.map(([id]) => id as string);
    expect(created).toEqual(["labshelf.writing.figures"]);
    expect(manifest.contributes.views.labshelfContainer.map((v) => v.id)).toEqual(expect.arrayContaining(created));
  });

  it("registers the outline reveal command, hidden from the palette", () => {
    setup("/lib");
    const registered = (vscode.commands.registerCommand as jest.Mock).mock.calls.map(([id]) => id as string);
    expect(registered).toContain("labshelf.writing.revealOutline");
    expect(manifest.contributes.menus.commandPalette).toContainEqual({ command: "labshelf.writing.revealOutline", when: "false" });
  });

  it("hides Run Check from the palette and offers Add Item while a project is open", () => {
    const palette = manifest.contributes.menus.commandPalette;
    expect(palette).toContainEqual({ command: "labshelf.writing.checklist.runCheck", when: "false" });
    expect(palette).toContainEqual({ command: "labshelf.writing.checklist.addItem", when: "labshelf.writing.projectOpen" });
  });

  it("lists projects at start and again when the library root changes", async () => {
    const { emitter, listProjects } = setup("/lib");
    await flush();
    expect(listProjects).toHaveBeenCalledTimes(1);
    emitter.fire({ root: vscode.Uri.file("/other") });
    await flush();
    expect(listProjects).toHaveBeenCalledTimes(2);
  });

  it("lists nothing while no library is configured", async () => {
    const { listProjects } = setup(undefined);
    await flush();
    expect(listProjects).not.toHaveBeenCalled();
  });
});
