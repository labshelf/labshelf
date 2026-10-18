// Registers the Writing builds of the web build: LaTeX through LabShelf Helper, via the editor page.
import * as vscode from "vscode";

import type { RegisterPlatformWriting } from "../platformPort/index.js";
import { HelperLatexBuilds } from "./helperLatexBuilds.js";
import { createHostPageLatexHelper, SHOW_HELPER_SETUP_COMMAND } from "./hostPageLatexHelper.js";

export const registerWebWriting: RegisterPlatformWriting = ({ host, projects, previews, diagnostics }) => {
  const latex = new HelperLatexBuilds({
    helper: createHostPageLatexHelper(), host, projects, previews, diagnostics,
    showHelperSetup: () => vscode.commands.executeCommand(SHOW_HELPER_SETUP_COMMAND),
  });
  // PLATFORM: on the web the editor page compiles Typst and shows its preview, so the extension never builds it.
  const typst = { request: async (): Promise<undefined> => undefined };
  return { builders: { latex, typst } };
};
