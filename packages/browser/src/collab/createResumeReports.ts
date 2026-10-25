// Shows what the resume of the shared projects reports at page start: a project whose key is missing, and a reconnect that failed.
import { formatError, type ResumeReports, type SharedProject } from "@labshelf/core";
import { showDialog, showToast } from "@labshelf/core/dom";

const projectName = (project: SharedProject): string => project.settings.title ?? project.settings.id;

/** `join` asks for an invite. */
export function createResumeReports(join: () => void): ResumeReports {
  return {
    missingKey: (project) => {
      void showDialog({
        title: `Shared project "${projectName(project)}": paste the invite to reconnect`,
        message: "This device holds no key of the share, so the project's files stay as they are until you join it again.",
        severity: "info",
        buttons: [{ id: "join" as const, label: "Join Shared Project…", primary: true }, { id: "later" as const, label: "Not Now" }],
      }).then((choice) => { if (choice === "join") { join(); } });
    },
    failed: (project, error) => {
      showToast(`Could not reconnect the shared project "${projectName(project)}": ${formatError(error)}`, "error");
    },
  };
}
