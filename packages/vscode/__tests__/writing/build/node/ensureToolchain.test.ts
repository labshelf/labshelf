// Tests the toolchain wrapper: the engine save reloads the project list, and a toolchain that is not ready is explained to the user.
import * as vscode from "vscode";

import { ensureToolchain as ensureCoreToolchain } from "@labshelf/core/node";
import { ensureToolchain } from "../../../../src/writing/build/node";
import { fakeHost, fakeProjects, readyEntry } from "../../../support/writingFixtures";

jest.mock("@labshelf/core/node", () => ({ ...jest.requireActual("@labshelf/core/node"), ensureToolchain: jest.fn() }));

const window = vscode.window as unknown as Record<string, jest.Mock>;
const core = ensureCoreToolchain as jest.Mock;
const entry = readyEntry("/code/repo");
const project = entry as Extract<typeof entry, { kind: "ready" }>;

function setup() {
  const projects = fakeProjects();
  return { projects, deps: { storageDir: "/storage", host: fakeHost(), projects: projects as never } };
}

beforeEach(() => jest.resetAllMocks());

it("returns the toolchain core prepared", async () => {
  const { deps } = setup();
  core.mockResolvedValue({ engine: "tectonic", executable: "/t" });
  expect(await ensureToolchain(deps, project)).toEqual({ engine: "tectonic", executable: "/t" });
});

it("saves the engine through the project data and reloads the list", async () => {
  const { deps, projects } = setup();
  core.mockImplementation(async (_project, coreDeps) => {
    await coreDeps.projects.updateProjectSettings("/code/repo", { engine: "tectonic" });
    return { engine: "tectonic", executable: "/t" };
  });

  await ensureToolchain(deps, project);

  expect(projects.data.updateProjectSettings).toHaveBeenCalledWith("/code/repo", { engine: "tectonic" });
  expect(projects.reload).toHaveBeenCalled();
});

it("is silent when the user declined", async () => {
  const { deps } = setup();
  core.mockResolvedValue({ status: "toolchain-missing", reason: "declined" });
  expect(await ensureToolchain(deps, project)).toBeUndefined();
  expect(window["showErrorMessage"]).not.toHaveBeenCalled();
});

it("says Tectonic is unsupported and offers the TeX Live guide", async () => {
  const { deps } = setup();
  core.mockResolvedValue({ status: "toolchain-missing", reason: "tectonic-unsupported" });
  window["showErrorMessage"]!.mockResolvedValue("Open TeX Live guide");

  expect(await ensureToolchain(deps, project)).toBeUndefined();

  expect(window["showErrorMessage"]).toHaveBeenCalledWith(
    expect.stringMatching(/^Tectonic is not available for .+ .+\. Install TeX Live instead\.$/), "Open TeX Live guide",
  );
  expect(vscode.env.openExternal).toHaveBeenCalled();
});

it("shows why the Tectonic download failed", async () => {
  const { deps } = setup();
  core.mockResolvedValue({ status: "toolchain-missing", reason: "download-failed", message: "Checksum mismatch" });

  expect(await ensureToolchain(deps, project)).toBeUndefined();

  expect(window["showErrorMessage"]).toHaveBeenCalledWith("Tectonic could not be installed: Checksum mismatch");
});
