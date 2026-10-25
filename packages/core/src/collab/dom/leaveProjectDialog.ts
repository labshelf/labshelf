// Stops sharing a project on this device after a confirmation; the files stay.
import { showDialog, toast } from "../../ui/dom/index.js";
import type { SharingHost } from "../../libraryUi/share/index.js";
import { reportingFailure } from "../../share/dom/index.js";
import { pickProject } from "./pickProject.js";

export function runLeaveProjectDialog(host: SharingHost, projectId?: string): Promise<void> {
  return reportingFailure("stop sharing the project", async () => {
    const project = await pickProject(host, projectId, true, "Stop Sharing on This Device");
    if (!project) return;
    const choice = await showDialog({
      title: `Stop sharing "${project.name}" on this device?`,
      message: "The files stay, and the others keep editing their copies. To come back, paste the invite again, which joins it as a new project.",
      severity: "danger",
      buttons: [{ id: "leave", label: "Stop Sharing", primary: true, danger: true }],
    });
    if (choice !== "leave") return;
    await host.leaveProject(project.id);
    toast(`"${project.name}" is no longer shared on this device. Its files stay.`, "ok");
  });
}
