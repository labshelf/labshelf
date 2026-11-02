// Shows a project note: every item of the file in the shared note view, saved through the project notes store, its cells run in the project folder.
import { mountNoteFileTab } from "./noteFileTab";
import type { TabModule } from "./tabKinds";

export const mountTab: TabModule["mountTab"] = (host, params, ctx) => {
  const projectId = params["projectId"] ?? "";
  const path = params["path"] ?? "";
  const notes = () => ctx.project().notes;
  return mountNoteFileTab(host, ctx, {
    label: path,
    // The D2 note key: the cells of one project note share a process per language.
    noteKey: `project:${projectId}:${path}`,
    read: () => notes().read(projectId, path),
    editItem: (itemId, body) => notes().editItem(projectId, path, itemId, body),
    runCell: (ports) => ports.runCellIn(projectId),
  });
};
