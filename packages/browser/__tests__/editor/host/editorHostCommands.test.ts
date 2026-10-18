// Pins the editor page's host commands: LaTeX goes through ILatexHelper, a missing helper mounts the setup card, the library folder.
import type { HelperCompileResult, ILatexHelper } from "@labshelf/core/helper";
// The host index also registers the commands with monaco-vscode-api, which jest cannot load, so the tests import the modules.
import { createEditorHostCommands, EDITOR_HOST_COMMANDS } from "../../../src/editor/host/editorHostCommands";
import { createHelperSetupShower } from "../../../src/editor/host/helperSetupShower";

function makeHelper() {
  return {
    connect: jest.fn(async () => ({ state: "not-installed" as const })),
    status: jest.fn(() => undefined),
    compile: jest.fn(async (..._args: Parameters<ILatexHelper["compile"]>): Promise<HelperCompileResult> => ({ status: "succeeded", problems: [], pdf: new Uint8Array([37, 80, 68, 70]) })),
    cancel: jest.fn(async (_projectId: string) => undefined),
    installTex: jest.fn(async (..._args: Parameters<ILatexHelper["installTex"]>) => undefined),
    installAllPackages: jest.fn(async (..._args: Parameters<ILatexHelper["installAllPackages"]>) => undefined),
  } satisfies ILatexHelper;
}

function setup() {
  const helper = makeHelper();
  const logger = { log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) };
  const showHelperSetup = jest.fn();
  const onProgress = jest.fn();
  const commands = createEditorHostCommands({ helper, logger, libraryFolder: "/library", showHelperSetup, onProgress });
  return { helper, logger, showHelperSetup, onProgress, commands };
}

describe("editor host commands", () => {
  it("answers the library folder", async () => {
    const { commands } = setup();
    expect(await commands[EDITOR_HOST_COMMANDS.libraryFolder]!()).toBe("/library");
  });

  it("compiles a LaTeX project through ILatexHelper, decoding the files and encoding the PDF", async () => {
    const { commands, helper, onProgress } = setup();
    const wire = { projectId: "thesis", main: "main.tex", engine: "pdflatex", files: [{ path: "main.tex", base64: "aGk=" }] };
    const result = await commands[EDITOR_HOST_COMMANDS.latexHelper]!("compile", wire);
    expect(helper.compile).toHaveBeenCalledWith(
      { projectId: "thesis", main: "main.tex", engine: "pdflatex", files: [{ path: "main.tex", bytes: new Uint8Array([104, 105]) }] }, onProgress);
    expect(result).toEqual({ status: "succeeded", problems: [], pdfBase64: "JVBERg==" });
  });

  it("forwards connect, cancel and the installs to ILatexHelper", async () => {
    const { commands, helper, onProgress } = setup();
    const call = commands[EDITOR_HOST_COMMANDS.latexHelper]!;
    expect(await call("connect")).toEqual({ state: "not-installed" });
    await call("cancel", "thesis");
    await call("installTex", "tinytex");
    await call("installAllPackages");
    expect(helper.cancel).toHaveBeenCalledWith("thesis");
    expect(helper.installTex).toHaveBeenCalledWith("tinytex", onProgress);
    expect(helper.installAllPackages).toHaveBeenCalledWith(onProgress);
  });

  it("logs and rejects an unknown method or a malformed project", async () => {
    const { commands, logger, helper } = setup();
    const call = commands[EDITOR_HOST_COMMANDS.latexHelper]!;
    await expect(call("format")).rejects.toThrow(/Unknown LaTeX helper method/);
    await expect(call("compile", { projectId: "p" })).rejects.toThrow(/project/);
    expect(helper.compile).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledTimes(2);
  });

  it("shows the helper setup when the web build asks for it", async () => {
    const { commands, showHelperSetup } = setup();
    await commands[EDITOR_HOST_COMMANDS.showHelperSetup]!();
    expect(showHelperSetup).toHaveBeenCalledTimes(1);
  });
});

describe("createHelperSetupShower", () => {
  it("mounts the setup card with the helper once and reveals it on every request", () => {
    const helper = makeHelper();
    const slot = { element: {} as HTMLElement, reveal: jest.fn() };
    const mount = jest.fn(() => ({ dispose: () => undefined }));
    const show = createHelperSetupShower(slot, helper, mount);
    show();
    show();
    expect(mount).toHaveBeenCalledTimes(1);
    expect(mount).toHaveBeenCalledWith(slot.element, helper);
    expect(slot.reveal).toHaveBeenCalledTimes(2);
  });
});
