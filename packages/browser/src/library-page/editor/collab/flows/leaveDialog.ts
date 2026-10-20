// Stops sharing a project on this device after the user confirms, through the core workflow, which keeps every file.
import { leaveSharedProject, type ILogger, type ShareWorkflowPorts } from "@labshelf/core";
import { confirmDialog, toast } from "@labshelf/core/dom";
import { errorText, projectName, type ReadyProject } from "./shareDialog";

const LOG_MODULE = "collab.leaveDialog";

export async function runLeaveDialog(context: { ports: ShareWorkflowPorts; logger: ILogger }, project: ReadyProject, shareId: string): Promise<void> {
  const name = projectName(project);
  const accepted = await confirmDialog(
    `Stop sharing "${name}" on this device?`,
    "The files stay, and the others keep editing their copies. To come back, paste the invite again, which joins it as a new project.",
    "Stop Sharing", true,
  );
  if (!accepted) { return; }
  try {
    await leaveSharedProject(context.ports, { folder: project.folder, shareId });
    toast(`"${name}" is not shared on this device any more. Its files stay.`, "ok");
  } catch (error) {
    await context.logger.error(LOG_MODULE, error, { action: "stop sharing a project", folder: project.folder, shareId });
    toast(`Could not stop sharing "${name}", so it stays shared: ${errorText(error)}`, "error");
  }
}
