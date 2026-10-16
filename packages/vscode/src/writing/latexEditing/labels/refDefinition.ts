// Jumps from a `\ref`-family name to the `\label` that defines it anywhere in the project.
import * as vscode from "vscode";

import { scanLatexSource } from "@labshelf/core";
import type { LatexProjectSources } from "../project/index.js";
import { labelLocation, projectLabels } from "./projectLabels.js";

export class RefDefinitionProvider implements vscode.DefinitionProvider {
  constructor(private readonly sources: LatexProjectSources) {}

  async provideDefinition(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Location[] | undefined> {
    const ref = scanLatexSource(document.getText()).refs.find(({ range }) =>
      range.start.line === position.line && range.start.character <= position.character && position.character <= range.end.character);
    if (!ref) { return undefined; }
    const project = await this.sources.projectSourcesFor(document);
    if (!project) { return undefined; }
    const found = projectLabels(project).filter((label) => label.name === ref.name).map((label) => labelLocation(project, label));
    return found.length > 0 ? found : undefined;
  }
}
