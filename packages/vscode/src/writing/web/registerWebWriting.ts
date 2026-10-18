// Registers the Writing builds of the web build, via the editor page: LaTeX through LabShelf Helper and Typst through the page's compiler.
import * as vscode from "vscode";

import { registerLatexOpenBuild, registerLatexSaveBuilds } from "../build/index.js";
import type { RegisterPlatformWriting } from "../platformPort/index.js";
import { registerTypstTriggers } from "../typst/index.js";
import { HelperLatexBuilds } from "./helperLatexBuilds.js";
import { createHostPageLatexHelper, SHOW_HELPER_SETUP_COMMAND } from "./hostPageLatexHelper.js";
import { HostPageTypstBuilds } from "./hostPageTypstBuilds.js";
import { compileTypstOnHostPage } from "./hostPageTypstCompiler.js";
import { registerWorkspaceProjectOpen } from "./openWorkspaceProject.js";

export const registerWebWriting: RegisterPlatformWriting = ({ context, host, projects, previews, diagnostics }) => {
  const latex = new HelperLatexBuilds({
    helper: createHostPageLatexHelper(), host, projects, previews, diagnostics,
    showHelperSetup: () => vscode.commands.executeCommand(SHOW_HELPER_SETUP_COMMAND),
  });
  // PLATFORM: the helper typesets whole documents, so a save builds its root without the include-only target.
  registerLatexSaveBuilds({ context, host, projects, request: (folder, root) => latex.request(folder, root, "save") });
  registerLatexOpenBuild({ context, host, projects, request: (folder, root) => latex.request(folder, root, "focus") });
  const typst = new HostPageTypstBuilds({ compile: compileTypstOnHostPage, host, projects, previews, diagnostics });
  registerTypstTriggers({ context, host, projects, hasPreview: (folder) => previews.hasPreview(folder), request: (folder, root, trigger) => typst.request(folder, root, trigger) });
  registerWorkspaceProjectOpen({ context, host, projects });
  return { builders: { latex, typst } };
};
