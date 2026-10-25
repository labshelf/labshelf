// Resolves the project a dialog acts on: the given id, or the user's pick from the host's list.
import { quickPick, toast } from "../../ui/dom/index.js";
import type { SharingHost, SharingProject } from "../../libraryUi/share/index.js";

/** `onlyShared` lists just the projects this device shares. Undefined when nothing was chosen. */
export async function pickProject(host: SharingHost, projectId: string | undefined, onlyShared: boolean, title: string): Promise<SharingProject | undefined> {
  const all = await host.projects();
  if (projectId !== undefined) {
    const found = all.find((p) => p.id === projectId);
    if (!found) toast("That project is not available here.", "info");
    return found;
  }
  const candidates = onlyShared ? all.filter((p) => p.shared) : all;
  if (candidates.length === 0) {
    toast(onlyShared ? "No project is shared on this device." : "There are no projects to share.", "info");
    return undefined;
  }
  return quickPick(
    candidates.map((p) => ({ label: p.name, ...(p.shared ? { description: "shared" } : {}), icon: "link" as const, value: p })),
    { title, placeholder: "Pick a project" },
  );
}
