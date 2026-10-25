// Tests the preview's project actions: command mapping, include-only, check limits and citation fixes without a library.
import * as vscode from "vscode";

import { setAutoCompile, setHaltOnError } from "../../../src/writing/build/index";
import { createProjectActions, type ProjectActionsDeps } from "../../../src/writing/preview/index";
import { setCheckLimits } from "../../../src/writing/preview/limits";
import { applyCitationFix } from "../../../src/writing/preview/citations/index";
import { fakeLogger, readyEntry } from "../../support/writingFixtures";

jest.mock("../../../src/writing/build/buildOptions", () => ({ setAutoCompile: jest.fn(async () => {}), setHaltOnError: jest.fn(async () => {}) }));
jest.mock("../../../src/writing/preview/limits", () => ({ setCheckLimits: jest.fn(async () => {}) }));
jest.mock("../../../src/writing/preview/citations/applyCitationFix", () => ({ applyCitationFix: jest.fn(async () => {}) }));

const project = readyEntry("/lib/paper") as ReturnType<ProjectActionsDeps["project"]> & object;

function setup(over: Partial<ProjectActionsDeps> = {}) {
  const deps = {
    logger: fakeLogger(),
    project: () => project,
    projects: { data: {}, paths: {}, reload: jest.fn() },
    setEngine: jest.fn(async () => {}),
    includeOnly: { set: jest.fn() },
    fixes: () => undefined,
    recompile: jest.fn(),
    resendRoots: jest.fn(),
    ...over,
  } as unknown as ProjectActionsDeps & { includeOnly: { set: jest.Mock }; recompile: jest.Mock; resendRoots: jest.Mock; logger: ReturnType<typeof fakeLogger> };
  return { deps, actions: createProjectActions(deps) };
}

beforeEach(() => jest.clearAllMocks());

describe("createProjectActions", () => {
  it("runs the labshelf.writing command of the id with the project entry", async () => {
    await setup().actions.runCommand("markVersion");
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith("labshelf.writing.markVersion", project);
  });

  it("sets the auto compile setting", async () => {
    await setup().actions.setAutoCompile("save");
    expect(setAutoCompile).toHaveBeenCalledWith("save");
  });

  it("sets the halt-on-error setting", async () => {
    await setup().actions.setHaltOnError(true);
    expect(setHaltOnError).toHaveBeenCalledWith(true);
  });

  it("switches include-only for the project folder and recompiles", async () => {
    const { deps, actions } = setup();
    await actions.setIncludeOnly(true);
    expect(deps.includeOnly.set).toHaveBeenCalledWith("/lib/paper", true);
    expect(deps.recompile).toHaveBeenCalledTimes(1);
  });

  it("writes the check limits and resends the roots", async () => {
    const { deps, actions } = setup();
    await actions.setCheckLimits({ pages: 8 });
    expect(setCheckLimits).toHaveBeenCalledWith(deps.projects, project, { pages: 8 });
    expect(deps.resendRoots).toHaveBeenCalledTimes(1);
  });

  it("warns and logs a citation fix asked without a library", async () => {
    const { deps, actions } = setup();
    await actions.fixCitation({ kind: "add", key: "k" });
    expect(applyCitationFix).not.toHaveBeenCalled();
    expect(vscode.window.showWarningMessage).toHaveBeenCalled();
    expect(deps.logger.log).toHaveBeenCalledWith("WARN", expect.any(String), expect.any(String), expect.objectContaining({ key: "k" }));
  });

  it("surfaces and logs a failure instead of dropping it", async () => {
    const { deps, actions } = setup({ setEngine: jest.fn(async () => { throw new Error("disk full"); }) });
    await actions.setEngine("xelatex");
    expect(deps.logger.error).toHaveBeenCalled();
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining("disk full"));
    expect(deps.resendRoots).not.toHaveBeenCalled();
  });

  it("warns when the project is gone", async () => {
    const { deps, actions } = setup({ project: () => undefined });
    await actions.setIncludeOnly(true);
    expect(deps.includeOnly.set).not.toHaveBeenCalled();
    expect(vscode.window.showWarningMessage).toHaveBeenCalled();
  });
});
