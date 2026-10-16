// Tests Build Project: it saves every editor and hands the active file's project to the builder of its format.
import * as vscode from "vscode";

import { BUILD_COMMAND, registerBuildCommand } from "../../../src/writing/build/registerBuildCommand";
import { commandHandler, fakeProjects, openInEditor, readyEntry } from "../../support/writingFixtures";

const window = vscode.window as unknown as Record<string, jest.Mock>;
const saveAll = (vscode.workspace as unknown as { saveAll: jest.Mock }).saveAll;

function setup() {
  const order: string[] = [];
  const builders = {
    latex: { request: jest.fn(async () => { order.push("latex"); return undefined; }) },
    typst: { request: jest.fn(async () => { order.push("typst"); return undefined; }) },
  };
  saveAll.mockImplementation(async () => { order.push("saveAll"); return true; });
  const projects = fakeProjects([
    readyEntry("/p/tex"),
    readyEntry("/p/typ", { main: "main.typ", settings: { id: "typ", format: "typst" } }),
  ]);
  registerBuildCommand({ context: { subscriptions: [] } as never, projects, builders });
  return { builders, order };
}

beforeEach(() => jest.clearAllMocks());

describe("registerBuildCommand", () => {
  it.each([["/p/typ/main.typ", "typst", "/p/typ"], ["/p/tex/main.tex", "latex", "/p/tex"]] as const)(
    "saves all editors, then builds %s with the %s builder", async (file, format, folder) => {
      const { builders, order } = setup();
      openInEditor(file);
      await commandHandler(BUILD_COMMAND)();
      expect(builders[format].request).toHaveBeenCalledWith(folder, "command");
      expect(order).toEqual(["saveAll", format]);
    });

  it("tells the user to open a project file when the active file is outside every project", async () => {
    const { builders } = setup();
    openInEditor("/elsewhere/a.typ");
    await commandHandler(BUILD_COMMAND)();
    expect(window["showInformationMessage"]).toHaveBeenCalledWith(expect.stringContaining("writing project"));
    expect(builders.typst.request).not.toHaveBeenCalled();
    expect(saveAll).not.toHaveBeenCalled();
  });

  it("does the same for a non-file document", async () => {
    setup();
    openInEditor("/p/typ/main.typ", "untitled");
    await commandHandler(BUILD_COMMAND)();
    expect(window["showInformationMessage"]).toHaveBeenCalledTimes(1);
  });
});
