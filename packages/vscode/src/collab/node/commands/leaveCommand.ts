// Stops sharing a project on this device: disconnects it, forgets its key and its share id, and keeps every file.
import { promises as fs } from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";

import { PROJECT_FILE, updateProjectFile } from "@labshelf/core";
import { LOG_MODULE, projectName, reportFailure, type CollabHost } from "../collabHost.js";
import { pickProject, type ProjectTarget } from "./projectTarget.js";

export const LEAVE_COMMAND = "labshelf.collab.leave";

async function confirmLeave(name: string): Promise<boolean> {
  const leave = "Stop Sharing";
  const answer = await vscode.window.showWarningMessage(
    `Stop sharing "${name}" on this device?`,
    { modal: true, detail: "The files stay, and the others keep editing their copies. To come back, paste the invite again, which joins it as a new project." },
    leave,
  );
  return answer === leave;
}

/** Asks first when run from the palette; a caller that passes the project already chose it. */
export async function leaveProject(host: CollabHost, target: ProjectTarget): Promise<boolean> {
  if (!(await host.requireLibrary())) { return false; }
  const project = await pickProject(host.projects, target, (entry) => entry.settings.shared !== undefined, "Shared project to stop sharing");
  const shareId = project?.settings.shared;
  if (!project || !shareId) {
    void vscode.window.showInformationMessage("No shared project to stop sharing.");
    return false;
  }
  const name = projectName(project);
  if (target === undefined && !(await confirmLeave(name))) { return false; }
  try {
    await host.shares.hold(shareId, async () => {
      await host.keys.forget(shareId);
      await host.shares.remove(shareId);
      const file = path.join(project.folder, PROJECT_FILE);
      await fs.writeFile(file, updateProjectFile(await fs.readFile(file, "utf8"), { shared: undefined }));
      await host.projects.reload();
    });
    void host.logger.log("INFO", LOG_MODULE, "Stopped sharing a project on this device", { folder: project.folder, shareId });
    void vscode.window.showInformationMessage(`"${name}" is no longer shared on this device. Its files stay.`);
    return true;
  } catch (error) {
    reportFailure(host.logger, `stop sharing "${name}"`, error, { folder: project.folder, shareId });
    return false;
  }
}
