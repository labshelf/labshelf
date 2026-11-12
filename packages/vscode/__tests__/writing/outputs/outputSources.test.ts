// Tests this machine's OutputSourcePort: the globalState mapping per project and source, the folder pick, the per-device command, and runs confirmed per exact command.
import * as vscode from "vscode";

import { createOutputSourceHost, OUTPUT_SOURCES_KEY } from "../../../src/writing/outputs/node/outputSources";

jest.mock("@labshelf/core/node", () => ({
  listSourceFolder: jest.fn(async () => ["a.csv"]),
  readSourceFile: jest.fn(async () => undefined),
  readGitRemote: jest.fn(async () => "git@github.com:ana/x.git"),
  runSourceCommand: jest.fn(async () => ({ status: "finished", code: 0, output: "ok" })),
}));
const node = jest.requireMock("@labshelf/core/node") as { runSourceCommand: jest.Mock; listSourceFolder: jest.Mock };

function memento() {
  const values = new Map<string, unknown>();
  return { get: jest.fn((key: string) => values.get(key)), update: jest.fn(async (key: string, value: unknown) => { values.set(key, value); }), keys: () => [...values.keys()], values };
}

const window = vscode.window as unknown as { showOpenDialog: jest.Mock; showWarningMessage: jest.Mock };

function create() {
  const globalState = memento();
  const workspaceState = memento();
  const host = createOutputSourceHost({
    globalState, workspaceState: workspaceState as unknown as vscode.Memento, output: { append: jest.fn(), appendLine: jest.fn() }, logger: { log: jest.fn(async () => {}), error: jest.fn(async () => {}) } as never,
  });
  return { host, globalState, workspaceState };
}

beforeEach(() => { jest.clearAllMocks(); });

describe("output source host", () => {
  it("stores a picked folder under the project and source key, separately per project", async () => {
    const { host, globalState } = create();
    window.showOpenDialog.mockResolvedValueOnce([vscode.Uri.file("/code/exp")]);
    await expect(host.portFor("p1").pick("exp")).resolves.toBe("/code/exp");
    expect(globalState.values.get(OUTPUT_SOURCES_KEY)).toEqual({ "p1\u0000exp": { folder: "/code/exp" } });
    await expect(host.portFor("p1").status("exp")).resolves.toEqual({ folder: "/code/exp" });
    await expect(host.portFor("p2").status("exp")).resolves.toBeUndefined();
  });

  it("answers undefined and stores nothing when the pick is cancelled", async () => {
    const { host, globalState } = create();
    window.showOpenDialog.mockResolvedValueOnce(undefined);
    await expect(host.portFor("p1").pick("exp")).resolves.toBeUndefined();
    expect(globalState.update).not.toHaveBeenCalled();
  });

  it("ignores malformed stored entries and unlinks", async () => {
    const { host, globalState } = create();
    globalState.values.set(OUTPUT_SOURCES_KEY, { "p1\u0000bad": { folder: 3 }, "p1\u0000exp": { folder: "/c" } });
    await expect(host.portFor("p1").status("bad")).resolves.toBeUndefined();
    await host.portFor("p1").unlink("exp");
    await expect(host.portFor("p1").status("exp")).resolves.toBeUndefined();
  });

  it("refuses to list a source that is not linked here", async () => {
    await expect(create().host.portFor("p1").list("exp")).rejects.toThrow("not linked");
    expect(node.listSourceFolder).not.toHaveBeenCalled();
  });

  it("answers declined and runs nothing when the user refuses the command", async () => {
    const { host, globalState } = create();
    globalState.values.set(OUTPUT_SOURCES_KEY, { "p1\u0000exp": { folder: "/c" } });
    window.showWarningMessage.mockResolvedValueOnce(undefined);
    await expect(host.portFor("p1").run("exp", "make", new AbortController().signal)).resolves.toEqual({ status: "declined" });
    expect(node.runSourceCommand).not.toHaveBeenCalled();
  });

  it("asks once for a shared command, then runs it in the folder", async () => {
    const { host, globalState } = create();
    globalState.values.set(OUTPUT_SOURCES_KEY, { "p1\u0000exp": { folder: "/c" } });
    window.showWarningMessage.mockResolvedValueOnce("Run Command");
    const port = host.portFor("p1");
    await expect(port.run("exp", "make", new AbortController().signal)).resolves.toEqual({ status: "finished", code: 0, output: "ok" });
    await port.run("exp", "make", new AbortController().signal);
    expect(window.showWarningMessage).toHaveBeenCalledTimes(1);
    expect(node.runSourceCommand).toHaveBeenCalledWith(expect.objectContaining({ folder: "/c", command: "make" }));
  });

  it("counts a command typed on this machine as confirmed and keeps it as the device's command", async () => {
    const { host, globalState } = create();
    globalState.values.set(OUTPUT_SOURCES_KEY, { "p1\u0000exp": { folder: "/c" } });
    const port = host.portFor("p1");
    await port.setCommand("exp", " python run.py ");
    await expect(port.status("exp")).resolves.toEqual({ folder: "/c", command: "python run.py" });
    await port.run("exp", "python run.py", new AbortController().signal);
    expect(window.showWarningMessage).not.toHaveBeenCalled();
    await port.setCommand("exp", undefined);
    await expect(port.status("exp")).resolves.toEqual({ folder: "/c" });
  });
});
