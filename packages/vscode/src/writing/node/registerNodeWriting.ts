// Registers the Writing commands and builds that need Node: figures, LaTeX and Typst builds, checks and version compare.
import { buildRootOf } from "@labshelf/core/node";
import * as vscode from "vscode";

import { hostPdfjs } from "../../pdf/node/index.js";
import { registerLatexBuild } from "../build/node/index.js";
import { registerCheckCommand } from "../check/node/index.js";
import { registerRegenerateFigure } from "../figures/node/index.js";
import type { RegisterNodeWriting } from "../nodePort/index.js";
import { registerTypstBuild } from "../typst/node/index.js";
import { registerCompareVersionsCommand } from "../versions/node/index.js";

export const registerNodeWriting: RegisterNodeWriting = ({ context, host, projects, figures, previews, diagnostics, reader }) => {
  const output = vscode.window.createOutputChannel("LabShelf Figures");
  context.subscriptions.push(output);
  registerRegenerateFigure({ context, host, figures, output });
  const builders = {
    latex: registerLatexBuild({ context, host, projects, previews, diagnostics }),
    typst: registerTypstBuild({ context, host, projects, previews, diagnostics, hasPreview: (folder) => previews.hasPreview(folder) }),
  };
  registerCheckCommand({ context, host, projects, builders, pdfjs: hostPdfjs });
  registerCompareVersionsCommand({ context, host, projects, builders, pdfjs: hostPdfjs, reader });
  return { builders, buildRootOf };
};
