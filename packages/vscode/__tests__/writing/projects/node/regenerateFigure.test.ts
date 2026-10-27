// Tests Regenerate Figure: the one-time confirmation per project and command, the run, the failure report and the refresh.
import * as vscode from "vscode";

import { runFigureCommand } from "@labshelf/core/node";
import type { FigureNode } from "../../../../src/writing/projects/index";
import { registerRegenerateFigure } from "../../../../src/writing/projects/node";
import { commandHandler, fakeHost, readyEntry } from "../../../support/writingFixtures";

jest.mock("@labshelf/core/node", () => ({ ...jest.requireActual("@labshelf/core/node"), runFigureCommand: jest.fn() }));

const run = runFigureCommand as jest.Mock;
const flush = () => new Promise((resolve) => setImmediate(resolve));

function nodeFor(command: string, folder = "/code/paper"): FigureNode {
  const project = readyEntry(folder, { location: "external" });
  if (project.kind !== "ready") { throw new Error("unreachable"); }
  return {
    kind: "figure", project, path: "fig/ablation.pdf", recipe: { run: command, inputs: ["plot.py"] },
    state: { status: "stale", newerInputs: ["plot.py"], missingInputs: [] },
  };
}

function setup() {
  const state = new Map<string, unknown>();
  const context = {
    subscriptions: [] as vscode.Disposable[],
    workspaceState: { get: (key: string) => state.get(key), update: jest.fn(async (key: string, value: unknown) => { state.set(key, value); }) },
  };
  const host = fakeHost();
  const figures = { refresh: jest.fn() };
  const output = { append: jest.fn(), appendLine: jest.fn(), show: jest.fn(), dispose: jest.fn() };
  registerRegenerateFigure({ context: context as never, host, figures, output: output as never });
  return { host, figures, output, context, regenerate: commandHandler("labshelf.writing.regenerateFigure") };
}

beforeEach(() => {
  jest.clearAllMocks();
  run.mockResolvedValue({ status: "finished", code: 0, output: "" });
  (vscode.window.showWarningMessage as jest.Mock).mockResolvedValue("Run Command");
});

describe("labshelf.writing.regenerateFigure", () => {
  it("asks naming the command and the folder, then runs it in the project folder and refreshes the tree", async () => {
    const { regenerate, figures } = setup();
    await regenerate(nodeFor("python plot.py"));
    const [message, options] = (vscode.window.showWarningMessage as jest.Mock).mock.calls[0]!;
    expect(message).toContain("python plot.py");
    expect(message).toContain("/code/paper");
    expect(options).toMatchObject({ modal: true });
    expect(options.detail).toContain("labshelf.yaml");
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ command: "python plot.py", cwd: "/code/paper" }));
    expect(figures.refresh).toHaveBeenCalledTimes(1);
  });

  it("asks only once for the same project and command", async () => {
    const { regenerate } = setup();
    await regenerate(nodeFor("python plot.py"));
    await regenerate(nodeFor("python plot.py"));
    expect(vscode.window.showWarningMessage).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("asks again after the command changes", async () => {
    const { regenerate } = setup();
    await regenerate(nodeFor("python plot.py"));
    await regenerate(nodeFor("python plot.py --evil"));
    expect(vscode.window.showWarningMessage).toHaveBeenCalledTimes(2);
  });

  it("asks again for the same command in another project", async () => {
    const { regenerate } = setup();
    await regenerate(nodeFor("python plot.py"));
    await regenerate(nodeFor("python plot.py", "/code/other"));
    expect(vscode.window.showWarningMessage).toHaveBeenCalledTimes(2);
  });

  it("stores the confirmation per machine in workspaceState, by folder and exact command", async () => {
    const { regenerate, context } = setup();
    await regenerate(nodeFor("python plot.py"));
    expect(context.workspaceState.update).toHaveBeenCalledWith(expect.any(String), { "/code/paper": ["python plot.py"] });
  });

  it("does not run, remember or refresh when the user declines", async () => {
    (vscode.window.showWarningMessage as jest.Mock).mockResolvedValue(undefined);
    const { regenerate, context } = setup();
    await regenerate(nodeFor("python plot.py"));
    await regenerate(nodeFor("python plot.py"));
    expect(run).not.toHaveBeenCalled();
    expect(context.workspaceState.update).not.toHaveBeenCalled();
    expect(vscode.window.showWarningMessage).toHaveBeenCalledTimes(2);
  });

  it("logs the failure with project, figure, command and exit code and offers the output", async () => {
    run.mockResolvedValue({ status: "finished", code: 2, output: "Traceback" });
    (vscode.window.showErrorMessage as jest.Mock).mockResolvedValue("Show Output");
    const { regenerate, host, output, figures } = setup();
    await regenerate(nodeFor("python plot.py"));
    await flush();
    expect(host.session.logger.error).toHaveBeenCalledWith(
      "writing/figures", expect.any(Error),
      { project: "paper", figure: "fig/ablation.pdf", command: "python plot.py", exitCode: 2 },
    );
    expect((vscode.window.showErrorMessage as jest.Mock).mock.calls[0]).toEqual([expect.stringContaining("exit code 2"), "Show Output"]);
    expect(output.show).toHaveBeenCalled();
    expect(figures.refresh).toHaveBeenCalled();
  });

  it("streams the command's output to the output channel", async () => {
    run.mockImplementation(async ({ onOutput }: { onOutput: (chunk: string) => void }) => {
      onOutput("plotting\n");
      return { status: "finished", code: 0, output: "plotting\n" };
    });
    const { regenerate, output } = setup();
    await regenerate(nodeFor("python plot.py"));
    expect(output.append).toHaveBeenCalledWith("plotting\n");
  });

  it("logs start and end and shows no error on success", async () => {
    const { regenerate, host } = setup();
    await regenerate(nodeFor("python plot.py"));
    const messages = (host.session.logger.log as jest.Mock).mock.calls.map((call) => call[2]);
    expect(messages).toEqual(["figure command started", "figure command finished"]);
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
  });

  it("reports nothing as an error when the user cancels", async () => {
    run.mockResolvedValue({ status: "cancelled" });
    const { regenerate, host } = setup();
    await regenerate(nodeFor("python plot.py"));
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
    expect(host.session.logger.error).not.toHaveBeenCalled();
  });

  it("surfaces a command that cannot start through the command error path and still refreshes", async () => {
    run.mockRejectedValue(new Error("spawn failed"));
    const { regenerate, host, figures } = setup();
    await regenerate(nodeFor("python plot.py"));
    expect(host.session.logger.error).toHaveBeenCalled();
    expect(figures.refresh).toHaveBeenCalled();
  });

  it("does nothing when it is not invoked on a figure row", async () => {
    const { regenerate } = setup();
    await regenerate(undefined);
    expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });
});
