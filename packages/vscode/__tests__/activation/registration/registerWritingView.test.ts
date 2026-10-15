// Tests that the Writing view registers exactly the commands package.json contributes and reloads when the library root changes.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as vscode from "vscode";

import { listProjects } from "@labshelf/core/node";
import { registerWritingView } from "../../../src/activation/registration/registerWritingView";
import type { LibraryRootController } from "../../../src/activation/libraryLifecycle";
import { fakeLogger } from "../../support/writingFixtures";

jest.mock("@labshelf/core/node", () => ({ ...jest.requireActual("@labshelf/core/node"), listProjects: jest.fn(async () => []) }));

const manifest = JSON.parse(readFileSync(join(__dirname, "../../../package.json"), "utf8")) as {
  contributes: { commands: { command: string }[]; views: { labshelfContainer: { id: string }[] } };
};

function setup(root: string | undefined) {
  const emitter = new vscode.EventEmitter<{ root: vscode.Uri }>();
  const controller = {
    currentRoot: () => (root ? vscode.Uri.file(root) : undefined),
    currentServices: () => (root ? { logger: fakeLogger() } : null),
    onDidChangeRoot: emitter.event,
    require: jest.fn(async () => null),
  } as unknown as LibraryRootController;
  registerWritingView({ subscriptions: [] } as unknown as vscode.ExtensionContext, controller);
  return { emitter };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

beforeEach(() => jest.clearAllMocks());

describe("registerWritingView", () => {
  it("registers every labshelf.writing command of package.json and no other", () => {
    setup("/lib");
    const registered = (vscode.commands.registerCommand as jest.Mock).mock.calls.map(([id]) => id as string).sort();
    const contributed = manifest.contributes.commands.map((c) => c.command).filter((id) => id.startsWith("labshelf.writing.")).sort();
    expect(registered).toEqual(contributed);
  });

  it("creates the contributed Writing tree view", () => {
    setup("/lib");
    expect((vscode.window.createTreeView as jest.Mock).mock.calls[0]![0]).toBe("labshelf.writing");
    expect(manifest.contributes.views.labshelfContainer.map((v) => v.id)).toContain("labshelf.writing");
  });

  it("lists projects at start and again when the library root changes", async () => {
    const { emitter } = setup("/lib");
    await flush();
    expect(listProjects).toHaveBeenCalledTimes(1);
    emitter.fire({ root: vscode.Uri.file("/other") });
    await flush();
    expect(listProjects).toHaveBeenCalledTimes(2);
  });

  it("lists nothing while no library is configured", async () => {
    setup(undefined);
    await flush();
    expect(listProjects).not.toHaveBeenCalled();
  });
});
