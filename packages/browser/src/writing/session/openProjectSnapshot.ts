// Builds the open project's Files, Outline and Checklist sidebar trees from its folder through core's builders.
import {
  buildChecklist, checklistSidebarNodes, citeSections, nestHeadings, outlineHeadings, posixPathOps, projectFileRow, readChecklistSignals, sectionPlacer, visibleEntries,
  type ChecklistGrouping, type HeadingNode, type ILogger, type LibraryFileSystem, type OutlineHeading, type ProjectEntry, type ProjectReadContext,
  type SidebarOpenProject, type SidebarProjectTree, type SidebarTreeNode,
} from "@labshelf/core";

const MODULE = "writing.session";

type ReadyProject = Extract<ProjectEntry, { kind: "ready" }>;

export type OpenProjectSnapshot = (entry: ProjectEntry, grouping: ChecklistGrouping) => Promise<SidebarOpenProject>;

export interface OpenProjectSnapshotOptions {
  fs: LibraryFileSystem;
  logger: ILogger;
}

async function filesNodes(context: ProjectReadContext, project: ReadyProject, dir: string, prefix: string): Promise<SidebarTreeNode[]> {
  const { fs, paths } = context;
  const names = await fs.listDir(dir);
  const stats = await Promise.all(names.map((name) => fs.stat(paths.join(dir, name))));
  const entries = names.flatMap((name, index) => (stats[index] ? [{ name, folder: stats[index].isDirectory }] : []));
  const rowContext = { format: project.settings.format, main: project.main };
  return Promise.all(visibleEntries(entries).map(async ({ name, folder }) => {
    const row = projectFileRow(`${prefix}${name}`, folder, rowContext);
    if (!folder) { return row.node; }
    return { ...row.node, children: await filesNodes(context, project, paths.join(dir, name), `${prefix}${name}/`) };
  }));
}

function outlineNodes(main: string, headings: HeadingNode<OutlineHeading>[]): SidebarTreeNode[] {
  return headings.map(({ entry, children }) => ({
    key: `${main}:${entry.line}`,
    label: entry.title || "Untitled",
    clickable: true,
    ...(children.length > 0 ? { children: outlineNodes(main, children), open: true } : {}),
  }));
}

async function readOutline(context: ProjectReadContext, project: ReadyProject): Promise<SidebarTreeNode[]> {
  if (project.main === undefined) { return []; }
  const text = await context.fs.readText(context.paths.join(project.folder, project.main));
  return outlineNodes(project.main, nestHeadings(outlineHeadings(project.settings.format, text)));
}

async function checklistNodes(context: ProjectReadContext, project: ReadyProject, grouping: ChecklistGrouping): Promise<SidebarTreeNode[]> {
  const signals = await readChecklistSignals(context, project);
  const main = project.main ?? "";
  const checklist = buildChecklist({
    ...signals, pageOverflow: undefined, reading: [], placeSection: sectionPlacer(signals.sources, main), citeSections: citeSections(signals.sources, main),
  }, grouping);
  return checklistSidebarNodes({ paths: posixPathOps, checklist, grouping, pageCount: undefined, reading: new Map(), isExpanded: (_, byDefault) => byDefault }).nodes;
}

export function createOpenProjectSnapshot({ fs, logger }: OpenProjectSnapshotOptions): OpenProjectSnapshot {
  const context: ProjectReadContext = { fs, paths: posixPathOps, logger };

  // One unreadable tree must not blank the others: it is logged and shown empty.
  const guard = async (view: SidebarProjectTree["view"], project: ReadyProject, build: () => Promise<SidebarTreeNode[]>): Promise<SidebarTreeNode[]> => {
    try { return await build(); } catch (error) {
      await logger.error(MODULE, error, { action: "build sidebar tree", view, folder: project.folder });
      return [];
    }
  };

  return async (entry, grouping) => {
    if (entry.kind !== "ready") { throw new Error(`${entry.folder}: a broken project has no sidebar trees`); }
    const [files, outline, checklist] = await Promise.all([
      guard("files", entry, () => filesNodes(context, entry, entry.folder, "")),
      guard("outline", entry, () => readOutline(context, entry)),
      guard("checklist", entry, () => checklistNodes(context, entry, grouping)),
    ]);
    return {
      id: entry.folder, name: entry.settings.title ?? entry.settings.id, format: entry.settings.format,
      trees: [
        { view: "files", title: "Files", actions: [{ action: "history", label: "History", icon: "history" }, { action: "comments", label: "Comments", icon: "message" }], nodes: files, empty: "No files." },
        { view: "outline", title: "Outline", actions: [], nodes: outline, empty: "Open a source file to see its outline." },
        {
          view: "checklist", title: "Checklist", actions: [], nodes: checklist, empty: "Nothing to do.",
          toggle: { options: [{ action: "byKind", label: "By kind" }, { action: "bySection", label: "By section" }], selected: grouping === "kind" ? "byKind" : "bySection" },
        },
      ],
    };
  };
}
