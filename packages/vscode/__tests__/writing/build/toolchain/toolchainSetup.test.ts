// Tests the toolchain setup: the first-run pick, TeX Live detection, the Tectonic download consent and the D5 error.
import * as vscode from "vscode";

import { findExecutable, installedTectonic, installTectonic } from "@labshelf/core/node";
import { ensureToolchain } from "../../../../src/writing/build/toolchain";
import { fakeHost, fakeProjects, readyEntry } from "../../../support/writingFixtures";

jest.mock("@labshelf/core/node", () => ({
  ...jest.requireActual("@labshelf/core/node"),
  findExecutable: jest.fn(), installedTectonic: jest.fn(), installTectonic: jest.fn(),
}));

const window = vscode.window as unknown as Record<string, jest.Mock>;
const project = (engine?: "tectonic" | "xelatex" | "pdflatex" | "lualatex") => {
  const entry = readyEntry("/code/repo", { settings: { id: "repo", format: "latex", ...(engine ? { engine } : {}) } });
  return entry as Extract<typeof entry, { kind: "ready" }>;
};

function setup() {
  const host = fakeHost();
  const projects = fakeProjects();
  return { host, projects, deps: { storageDir: "/storage", host, projects: projects as never } };
}

const latexmkOnPath = (found: boolean) => (findExecutable as jest.Mock).mockResolvedValue(found ? "/usr/bin/latexmk" : undefined);

beforeEach(() => {
  jest.resetAllMocks();
  window["withProgress"]!.mockImplementation(async (_options, task) =>
    task({ report: jest.fn() }, { isCancellationRequested: false, onCancellationRequested: jest.fn() }));
  latexmkOnPath(false);
});

describe("first-run pick", () => {
  it("writes engine tectonic when Tectonic is picked, then continues with it", async () => {
    const { deps, projects } = setup();
    window["showQuickPick"]!.mockImplementation(async (items) => items.find((item: { engine: string }) => item.engine === "tectonic"));
    (installedTectonic as jest.Mock).mockResolvedValue("/storage/tectonic/0.17.0/tectonic");

    const toolchain = await ensureToolchain(deps, project());

    expect(projects.data.updateProjectSettings).toHaveBeenCalledWith("/code/repo", { engine: "tectonic" });
    expect(projects.reload).toHaveBeenCalled();
    expect(toolchain).toEqual({ engine: "tectonic", executable: "/storage/tectonic/0.17.0/tectonic" });
  });

  it("lists TeX Live first when latexmk is on PATH and writes pdflatex for it", async () => {
    const { deps, projects } = setup();
    latexmkOnPath(true);
    window["showQuickPick"]!.mockImplementation(async (items) => items[0]);

    const toolchain = await ensureToolchain(deps, project());

    const items = window["showQuickPick"]!.mock.calls[0]![0];
    expect(items.map((item: { label: string }) => item.label)).toEqual(["TeX Live (latexmk)", "XeLaTeX (Tectonic)"]);
    expect(items[1].description).toBe("recommended");
    expect(items[1].detail).toMatch(/Downloads about \d+ MB once/);
    expect(projects.data.updateProjectSettings).toHaveBeenCalledWith("/code/repo", { engine: "pdflatex" });
    expect(toolchain).toEqual({ engine: "pdflatex", executable: "/usr/bin/latexmk" });
  });

  it("says TeX Live is not installed when latexmk is missing, and writes nothing on Escape", async () => {
    const { deps, projects } = setup();
    window["showQuickPick"]!.mockResolvedValue(undefined);

    expect(await ensureToolchain(deps, project())).toBeUndefined();

    const items = window["showQuickPick"]!.mock.calls[0]![0];
    expect(items[0].label).toBe("XeLaTeX (Tectonic)");
    expect(items[1].detail).toBe("TeX Live is not installed.");
    expect(projects.data.updateProjectSettings).not.toHaveBeenCalled();
  });
});

describe("engine tectonic", () => {
  it("returns the installed binary without any prompt", async () => {
    const { deps } = setup();
    (installedTectonic as jest.Mock).mockResolvedValue("/storage/tectonic/0.17.0/tectonic");

    expect(await ensureToolchain(deps, project("tectonic"))).toEqual({
      engine: "tectonic", executable: "/storage/tectonic/0.17.0/tectonic",
    });
    expect(window["showQuickPick"]).not.toHaveBeenCalled();
    expect(window["showInformationMessage"]).not.toHaveBeenCalled();
    expect(installTectonic).not.toHaveBeenCalled();
  });

  it("downloads only after the user consents in a modal naming version, size and GitHub", async () => {
    const { deps, host } = setup();
    (installedTectonic as jest.Mock).mockResolvedValue(undefined);
    (installTectonic as jest.Mock).mockResolvedValue("/storage/tectonic/0.17.0/tectonic");
    window["showInformationMessage"]!.mockResolvedValue("Download");

    const toolchain = await ensureToolchain(deps, project("tectonic"));

    const [message, options] = window["showInformationMessage"]!.mock.calls[0]!;
    expect(message).toMatch(/Tectonic 0\.17\.0 \(about \d+ MB\)/);
    expect(options).toMatchObject({ modal: true, detail: expect.stringContaining("GitHub") });
    expect(installTectonic).toHaveBeenCalledWith("/storage", { logger: host.session.logger, signal: expect.any(AbortSignal) });
    expect(toolchain?.executable).toBe("/storage/tectonic/0.17.0/tectonic");
  });

  it("makes no download when the user declines", async () => {
    const { deps } = setup();
    (installedTectonic as jest.Mock).mockResolvedValue(undefined);
    window["showInformationMessage"]!.mockResolvedValue(undefined);

    expect(await ensureToolchain(deps, project("tectonic"))).toBeUndefined();
    expect(installTectonic).not.toHaveBeenCalled();
  });

  it("shows the reason when the download fails", async () => {
    const { deps } = setup();
    (installedTectonic as jest.Mock).mockResolvedValue(undefined);
    (installTectonic as jest.Mock).mockRejectedValue(new Error("Checksum mismatch"));
    window["showInformationMessage"]!.mockResolvedValue("Download");

    expect(await ensureToolchain(deps, project("tectonic"))).toBeUndefined();
    expect(window["showErrorMessage"]).toHaveBeenCalledWith(expect.stringContaining("Checksum mismatch"));
  });

  it("aborts the download when the notification is cancelled, without an error message", async () => {
    const { deps } = setup();
    (installedTectonic as jest.Mock).mockResolvedValue(undefined);
    window["showInformationMessage"]!.mockResolvedValue("Download");
    window["withProgress"]!.mockImplementation(async (_options, task) => {
      let cancel = () => {};
      const pending = task({ report: jest.fn() }, { onCancellationRequested: (listener: () => void) => { cancel = listener; } });
      cancel();
      return pending;
    });
    let received: AbortSignal | undefined;
    (installTectonic as jest.Mock).mockImplementation(async (_dir, { signal }: { signal: AbortSignal }) => {
      received = signal;
      throw new Error("aborted");
    });

    expect(await ensureToolchain(deps, project("tectonic"))).toBeUndefined();
    expect(window["showErrorMessage"]).not.toHaveBeenCalled();
    expect(received?.aborted).toBe(true);
  });
});

describe("TeX Live engines", () => {
  it("returns latexmk when it is on PATH", async () => {
    const { deps } = setup();
    latexmkOnPath(true);
    expect(await ensureToolchain(deps, project("lualatex"))).toEqual({ engine: "lualatex", executable: "/usr/bin/latexmk" });
  });

  it("explains that pdfLaTeX needs TeX Live when latexmk is missing", async () => {
    const { deps } = setup();
    window["showErrorMessage"]!.mockResolvedValue(undefined);

    expect(await ensureToolchain(deps, project("pdflatex"))).toBeUndefined();
    expect(window["showErrorMessage"]).toHaveBeenCalledWith(
      "pdfLaTeX needs TeX Live, which is not installed. Tectonic runs only XeLaTeX.", "Open install guide", "Use Tectonic",
    );
  });

  it("opens the install guide for the platform", async () => {
    const { deps } = setup();
    window["showErrorMessage"]!.mockResolvedValue("Open install guide");

    await ensureToolchain(deps, project("xelatex"));

    expect(vscode.env.openExternal).toHaveBeenCalledWith(expect.objectContaining({ scheme: "https" }));
  });

  it("switches the project to Tectonic on Use Tectonic", async () => {
    const { deps, projects } = setup();
    window["showErrorMessage"]!.mockResolvedValue("Use Tectonic");
    (installedTectonic as jest.Mock).mockResolvedValue("/storage/tectonic/0.17.0/tectonic");

    const toolchain = await ensureToolchain(deps, project("pdflatex"));

    expect(projects.data.updateProjectSettings).toHaveBeenCalledWith("/code/repo", { engine: "tectonic" });
    expect(projects.reload).toHaveBeenCalled();
    expect(toolchain).toEqual({ engine: "tectonic", executable: "/storage/tectonic/0.17.0/tectonic" });
  });
});
