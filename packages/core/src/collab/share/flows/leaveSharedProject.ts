// Stops sharing a project on this device: closes its connection, forgets its key and share id, and keeps every file.
// CONTRACT: documents/contracts/collaboration.md#membership
import { parseProjectFile, PROJECT_FILE, updateProjectFile, type ProjectReadContext } from "../../../writing/project/index.js";
import { LOG_MODULE, type ShareFlowPorts } from "./sharePorts.js";

/** Removes `shared` from labshelf.yaml when it names this share, keeping every other key and comment. */
async function clearSharedField({ fs, paths }: ProjectReadContext, folder: string, shareId: string): Promise<void> {
  const file = paths.join(folder, PROJECT_FILE);
  const text = await fs.readText(file);
  const parsed = parseProjectFile(text);
  if (parsed.ok && parsed.settings.shared !== shareId) { return; }
  await fs.writeText(file, updateProjectFile(text, { shared: undefined }));
}

/**
 * The other members keep the share; nothing on the relay is deleted. When the connection cannot store its pending updates the
 * leave stops before anything is forgotten, so the key, the `shared` field and the stored state stay and a retry loses nothing.
 */
export async function leaveSharedProject(ports: ShareFlowPorts, project: { folder: string; shareId: string }): Promise<void> {
  const { folder, shareId } = project;
  await ports.shares.hold(shareId, async () => {
    try {
      await ports.shares.remove(shareId);
    } catch (error) {
      throw new Error(`The shared project in ${folder} could not store its last edits, so it stays shared: ${String(error)}`, { cause: error });
    }
    await ports.keys.forget(shareId);
    await clearSharedField(ports.files, folder, shareId);
    await ports.deleteState(shareId);
    await ports.projects.reload();
  });
  void ports.logger.log("INFO", LOG_MODULE, "Stopped sharing a project on this device", { folder, shareId });
}
