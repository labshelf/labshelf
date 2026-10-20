// Keeps the connected shares in step with the project list: reconnects shared projects whose key is stored, drops the rest.
import { isSharedProject, LOG_MODULE, type SharedProject, type ShareWorkflowPorts } from "./sharePorts.js";

export interface ResumeReports {
  /** Once per share: the project is shared, but this device holds no key of it. */
  missingKey(project: SharedProject): void;
  /** Once per share: the reconnect failed, and the next pass would fail the same way. */
  failed(project: SharedProject, error: unknown): void;
}

export interface ShareResumer {
  /** Runs one pass after the passes already queued; call it on every reload of the project list. */
  sync(): Promise<void>;
}

export function createShareResumer(ports: ShareWorkflowPorts, reports: ResumeReports): ShareResumer {
  const reported = new Set<string>();
  let running = Promise.resolve();
  return {
    sync: () => (running = running.then(() => syncPass(ports, reports, reported))),
  };
}

async function syncPass(ports: ShareWorkflowPorts, reports: ResumeReports, reported: Set<string>): Promise<void> {
  const shared = ports.projects.list().filter(isSharedProject);
  for (const share of ports.shares.list()) {
    if (ports.shares.isBusy(share.shareId)) { continue; }
    if (shared.some((project) => project.folder === share.folder && project.settings.shared === share.shareId)) { continue; }
    void ports.logger.log("INFO", LOG_MODULE, "Disconnected a share whose project left the list", { folder: share.folder, shareId: share.shareId });
    await ports.shares.remove(share.shareId).catch((error: unknown) =>
      ports.logger.error(LOG_MODULE, error, { action: "close a share whose project left the list", shareId: share.shareId }));
  }
  for (const project of shared) {
    const shareId = project.settings.shared;
    if (ports.shares.active(shareId) || ports.shares.isBusy(shareId) || reported.has(shareId)) { continue; }
    await resume(ports, project, reports, reported).catch((error: unknown) => {
      reported.add(shareId);
      void ports.logger.error(LOG_MODULE, error, { action: "reconnect a shared project", folder: project.folder, shareId });
      reports.failed(project, error);
    });
  }
}

async function resume(ports: ShareWorkflowPorts, project: SharedProject, reports: ResumeReports, reported: Set<string>): Promise<void> {
  const shareId = project.settings.shared;
  await ports.shares.hold(shareId, async () => {
    const stored = await ports.keys.invite(shareId);
    if (!stored) {
      reported.add(shareId);
      void ports.logger.log("WARN", LOG_MODULE, "A shared project has no stored key on this device", { folder: project.folder, shareId });
      reports.missingKey(project);
      return;
    }
    ports.shares.add(await ports.connect(stored, { mode: "resume", folder: project.folder }));
    void ports.logger.log("INFO", LOG_MODULE, "Resumed a shared project", { folder: project.folder, shareId });
  });
}
