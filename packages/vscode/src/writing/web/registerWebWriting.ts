// Registers the Writing builds of the web build: LaTeX through LabShelf Helper, via the editor page, on open, on save and on command.
import * as vscode from "vscode";

import { registerLatexOpenBuild, registerLatexSaveBuilds } from "../build/index.js";
import type { RegisterPlatformWriting } from "../platformPort/index.js";
import { HelperLatexBuilds } from "./helperLatexBuilds.js";
import { createHostPageLatexHelper, SHOW_HELPER_SETUP_COMMAND } from "./hostPageLatexHelper.js";

export const registerWebWriting: RegisterPlatformWriting = ({ context, host, projects, previews, diagnostics }) => {
  const latex = new HelperLatexBuilds({
    helper: createHostPageLatexHelper(), host, projects, previews, diagnostics,
    showHelperSetup: () => vscode.commands.executeCommand(SHOW_HELPER_SETUP_COMMAND),
  });
  // PLATFORM: the helper typesets whole documents, so a save builds its root without the include-only target.
  registerLatexSaveBuilds({ context, host, projects, request: (folder, root) => latex.request(folder, root, "save") });
  registerLatexOpenBuild({ context, host, projects, request: (folder, root) => latex.request(folder, root, "focus") });
  // PLATFORM: on the web the editor page compiles Typst and shows its preview, so the extension never builds it.
  const typst = { request: async (): Promise<undefined> => undefined };
  return { builders: { latex, typst } };
};
