// Tests Save project as template: the engine of a LaTeX project without one, and the license question.
import * as vscode from "vscode";

import { saveProjectAsTemplate } from "@labshelf/core/node";
import { ensureToolchain } from "../../../../src/writing/build/node";
import { registerSaveProjectCommand } from "../../../../src/writing/templates/node/saveProjectCommand";
import { commandHandler, fakeHost, fakeProjects, readyEntry } from "../../../support/writingFixtures";

jest.mock("@labshelf/core/node", () => ({ ...jest.requireActual("@labshelf/core/node"), saveProjectAsTemplate: jest.fn() }));
jest.mock("../../../../src/writing/build/node", () => ({ ensureToolchain: jest.fn() }));

const save = saveProjectAsTemplate as jest.Mock;
const toolchain = ensureToolchain as jest.Mock;
const window = vscode.window as unknown as Record<string, jest.Mock>;

function setup() {
  const host = fakeHost();
  const onSaved = jest.fn();
  registerSaveProjectCommand({
    context: { subscriptions: [], globalStorageUri: vscode.Uri.file("/storage") } as never,
    host, projects: fakeProjects() as never, onSaved,
  });
  return { host, onSaved };
}

/** Answers the detail questions in order: name, license, description, authors; the category is picked from the list. */
function answers(license = "MIT"): void {
  const queue = ["Survey", license, "A survey", "Ada, Grace"];
  window["showInputBox"]!.mockImplementation(async () => queue.shift());
  window["showQuickPick"]!.mockImplementation(async (items: unknown[]) => items[0]);
}

beforeEach(() => {
  jest.clearAllMocks();
  save.mockResolvedValue({ name: "Survey" });
});

describe("labshelf.templates.saveProject", () => {
  it("asks the toolchain for the engine of a LaTeX project without one and saves with it", async () => {
    const { onSaved } = setup();
    answers();
    toolchain.mockResolvedValue({ engine: "xelatex" });

    await commandHandler("labshelf.templates.saveProject")(readyEntry("/lib/projects/survey"));

    expect(save).toHaveBeenCalledWith("/lib", "survey", expect.objectContaining({ engine: "xelatex", license: "MIT", authors: ["Ada", "Grace"] }), expect.anything());
    expect(onSaved).toHaveBeenCalled();
  });

  it("saves nothing when the engine choice is cancelled", async () => {
    setup();
    answers();
    toolchain.mockResolvedValue(undefined);

    await commandHandler("labshelf.templates.saveProject")(readyEntry("/lib/projects/survey"));

    expect(save).not.toHaveBeenCalled();
  });

  it("does not ask for an engine when the project has one", async () => {
    setup();
    answers();

    await commandHandler("labshelf.templates.saveProject")(readyEntry("/lib/projects/survey", { settings: { id: "survey", format: "latex", engine: "pdflatex" } }));

    expect(toolchain).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledWith("/lib", "survey", expect.not.objectContaining({ engine: expect.anything() }), expect.anything());
  });

  it("refuses a license that is not an SPDX expression, with a message", async () => {
    setup();
    answers();
    await commandHandler("labshelf.templates.saveProject")(readyEntry("/lib/projects/survey"));

    const licenseQuestion = window["showInputBox"]!.mock.calls.map(([options]) => options).find((options) => options.prompt.startsWith("License"));
    expect(licenseQuestion.validateInput("not a license!")).toMatch(/SPDX/);
    expect(licenseQuestion.validateInput("CC-BY-4.0")).toBeUndefined();
  });
});
