// Registers the Writing commands and builds that need Node: figures, external project folders, LaTeX and Typst builds, checks, version compare, the project history and the template gallery.
import * as vscode from "vscode";

import { hostPdfjs } from "../../pdf/node/index.js";
import { createVscodeTex, registerLatexBuild } from "../build/node/index.js";
import { registerCheckCommand } from "../check/node/index.js";
import { registerRegenerateFigure } from "../figures/node/index.js";
import type { RegisterPlatformWriting } from "../platformPort/index.js";
import { registerTemplates } from "../templates/node/index.js";
import { registerTypstBuild } from "../typst/node/index.js";
import { registerCompareVersionsCommand } from "../versions/node/index.js";
import { registerProjectHistory } from "../history/node/index.js";
import { registerAddExistingFolder } from "../projectCommands.js";

export const registerNodeWriting: RegisterPlatformWriting = ({ context, host, projects, figures, previews, diagnostics, reader, onFindings, includeOnlyTarget }) => {
  const output = vscode.window.createOutputChannel("LabShelf Figures");
  context.subscriptions.push(output);
  registerRegenerateFigure({ context, host, figures, output });
  registerAddExistingFolder({ context, host, projects });
  const tex = createVscodeTex(host);
  const builders = {
    latex: registerLatexBuild({ context, host, tex, projects, previews, diagnostics, ...(includeOnlyTarget && { includeOnlyTarget }) }),
    typst: registerTypstBuild({ context, host, tex, projects, previews, diagnostics, hasPreview: (folder) => previews.hasPreview(folder) }),
  };
  registerCheckCommand({ context, host, projects, builders, pdfjs: hostPdfjs, ...(onFindings && { onFindings }) });
  registerCompareVersionsCommand({ context, host, tex, projects, builders, pdfjs: hostPdfjs, reader });
  registerTemplates({ context, host, tex, projects, builders });
  const history = registerProjectHistory({ context, host, projects });
  return { builders, history };
};
