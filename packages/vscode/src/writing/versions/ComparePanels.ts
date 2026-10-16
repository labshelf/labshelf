// Opens the reader panels of a version comparison: one per side, or one for a marked-up PDF.
import * as path from "node:path";
import * as vscode from "vscode";

import type { ILogger, PageArea, PaperRecord } from "@labshelf/core";
import { ReaderPanel, type ReaderPanelDeps } from "../../pdf-viewer/index.js";
import { createPreviewStore } from "../preview/index.js";
import type { ReadyProject } from "../mainDocument.js";
import type { CompareSide } from "./compareSides.js";

type ShowIn = NonNullable<Parameters<typeof ReaderPanel.createOrShow>[1]["show"]>;

interface OpenedPanel {
  panel: ReaderPanel;
  /** False when the panel was already open and only revealed. */
  fresh: boolean;
}

export class ComparePanels {
  private readonly open = new Set<string>();

  constructor(private readonly deps: Omit<ReaderPanelDeps, "logger">) {}

  /** Shows `base` in the active column and `other` beside it, each with its changed regions marked. */
  showSides(logger: ILogger, project: ReadyProject, sides: { base: CompareSide; other: CompareSide }, changes: { before: PageArea[]; after: PageArea[] }): void {
    const base = this.show(logger, project, sides.base, `compare:${project.folder}:${sides.base.slug}`, vscode.ViewColumn.Active);
    const other = this.show(logger, project, sides.other, `compare:${project.folder}:${sides.other.slug}`, { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true });
    this.mark(base, changes.before);
    this.mark(other, changes.after);
  }

  /** Shows one PDF, e.g. a marked-up diff, beside the editor. */
  showPdf(logger: ILogger, project: ReadyProject, side: CompareSide, key: string): void {
    this.show(logger, project, side, `compare:${project.folder}:${key}`, { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false });
  }

  // A panel left open by an earlier comparison may show a stale file (the current build changed); a fresh one loads it once.
  private mark({ panel, fresh }: OpenedPanel, areas: PageArea[]): void {
    if (!fresh) { panel.controller.reloadDocument(); }
    panel.controller.showChanges(areas);
  }

  private show(logger: ILogger, project: ReadyProject, side: CompareSide, key: string, column: ShowIn): OpenedPanel {
    const fresh = !this.open.has(key);
    const dir = path.dirname(side.pdfPath);
    const paper: PaperRecord = {
      id: `compare:${project.settings.id}:${side.slug}`, title: `${side.name} — ${project.settings.id}`, path: dir, citeKey: "", status: "reading",
    };
    const panel = ReaderPanel.createOrShow({ ...this.deps, logger }, {
      key, paper, store: createPreviewStore(), pdfUri: vscode.Uri.file(side.pdfPath), rootDir: vscode.Uri.file(dir), show: column,
      onClosed: () => { this.open.delete(key); },
    });
    this.open.add(key);
    return { panel, fresh };
  }
}
