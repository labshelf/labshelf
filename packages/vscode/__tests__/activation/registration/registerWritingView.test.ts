// Tests that the Writing views register exactly the commands package.json contributes and reloads when the library root changes.
import * as path from "node:path";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as vscode from "vscode";

import { registerWritingView } from "../../../src/activation/registration/registerWritingView";
import type { LibraryRootController } from "../../../src/activation/libraryLifecycle";
import type { RegisterNodeWriting } from "../../../src/writing/nodePort";
import { registerNodeWriting } from "../../../src/writing/node";
import { fakeLogger, fakeProjectData } from "../../support/writingFixtures";

const manifest = JSON.parse(readFileSync(join(__dirname, "../../../package.json"), "utf8")) as {
  contributes: { commands: { command: string }[]; menus: { commandPalette: { command: string; when: string }[] }; views: { labshelfContainer: { id: string }[] } };
};

const builders = { latex: { request: jest.fn() }, typst: { request: jest.fn() } };
const fakeRegisterNodeWriting: RegisterNodeWriting = () => ({ builders, buildRootOf: async (_folder, main) => main });

function setup(root: string | undefined, register: RegisterNodeWriting = fakeRegisterNodeWriting) {
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
  registerWritingView(context as unknown as vscode.ExtensionContext, controller, { locatePdfjs: () => null, isMac: false }, { paths: path, createProjectData: () => data }, register);
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

  it("creates the contributed Files, Outline, Checklist, Figures and Versions tree views", () => {
    setup("/lib");
    const created = (vscode.window.createTreeView as jest.Mock).mock.calls.map(([id]) => id as string);
    expect(created).toEqual(["labshelf.writing.figures", "labshelf.writing.versions", "labshelf.writing.files", "labshelf.writing.outline", "labshelf.writing.checklist"]);
    expect(manifest.contributes.views.labshelfContainer.map((v) => v.id)).toEqual(expect.arrayContaining(created));
  });

  it("registers the outline reveal command, hidden from the palette", () => {
    setup("/lib");
    const registered = (vscode.commands.registerCommand as jest.Mock).mock.calls.map(([id]) => id as string);
    expect(registered).toContain("labshelf.writing.revealOutline");
    expect(manifest.contributes.menus.commandPalette).toContainEqual({ command: "labshelf.writing.revealOutline", when: "false" });
  });

  it("hides the Checklist row commands from the palette and offers Add Item while a project is open", () => {
    const palette = manifest.contributes.menus.commandPalette;
    for (const id of ["bySection", "byKind", "removeItem", "nextStatus", "runCheck"]) {
      expect(palette).toContainEqual({ command: `labshelf.writing.checklist.${id}`, when: "false" });
    }
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
