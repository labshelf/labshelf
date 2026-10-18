// Answers the host commands LabShelf's web build calls on the editor page: the library folder, LaTeX through the helper, its setup card.
import type { ILogger } from "@labshelf/core";
import {
  compileResultToWire, projectFromWire, TEX_INSTALL_KINDS, type HelperProgressListener, type ILatexHelper,
} from "@labshelf/core/helper";

export const EDITOR_HOST_COMMANDS = {
  // CONTRACT: documents/contracts/editor-host.md#library-folder
  libraryFolder: "labshelf.editorHost.libraryFolder",
  // CONTRACT: documents/contracts/editor-host.md#latex-helper
  latexHelper: "labshelf.editorHost.latexHelper",
  // CONTRACT: documents/contracts/editor-host.md#helper-setup
  showHelperSetup: "labshelf.editorHost.showHelperSetup",
} as const;

const MODULE = "browser.editor.host";

export interface EditorHostDeps {
  helper: ILatexHelper;
  logger: ILogger;
  /** The library folder as the workbench names it (a file: path). */
  libraryFolder: string;
  showHelperSetup(): void;
  /** Hears build and install progress, which cannot cross back to the extension. */
  onProgress: HelperProgressListener;
}

export type HostCommand = (...args: unknown[]) => Promise<unknown>;

function helperCall(helper: ILatexHelper, onProgress: HelperProgressListener, method: unknown, args: unknown[]): Promise<unknown> {
  switch (method) {
    case "connect": return helper.connect();
    case "compile": return helper.compile(projectFromWire(args[0]), onProgress).then(compileResultToWire);
    case "cancel":
      if (typeof args[0] !== "string") throw new Error("cancel needs a project id");
      return helper.cancel(args[0]);
    case "installTex": {
      const kind = TEX_INSTALL_KINDS.find((known) => known === args[0]);
      if (kind === undefined) throw new Error(`Unknown TeX install kind ${JSON.stringify(args[0])}`);
      return helper.installTex(kind, onProgress);
    }
    case "installAllPackages": return helper.installAllPackages(onProgress);
    default: throw new Error(`Unknown LaTeX helper method ${JSON.stringify(method)}`);
  }
}

export function createEditorHostCommands(deps: EditorHostDeps): Record<string, HostCommand> {
  const { helper, logger, onProgress } = deps;
  return {
    [EDITOR_HOST_COMMANDS.libraryFolder]: async () => {
      await logger.log("INFO", MODULE, "LabShelf asked for the library folder", { folder: deps.libraryFolder });
      return deps.libraryFolder;
    },
    [EDITOR_HOST_COMMANDS.latexHelper]: async (method, ...args) => {
      try {
        return await helperCall(helper, onProgress, method, args);
      } catch (error) {
        await logger.error(MODULE, error, { action: "latex helper", method: String(method) });
        throw error;
      }
    },
    [EDITOR_HOST_COMMANDS.showHelperSetup]: async () => { deps.showHelperSetup(); },
  };
}
