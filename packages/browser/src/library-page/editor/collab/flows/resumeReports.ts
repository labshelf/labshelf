// Shows what the resume of the shared projects reports at page start: a project whose key is missing, and a reconnect that failed.
import { errorMessage, type ILogger, type ResumeReports, type SharedProject } from "@labshelf/core";
import { showDialog, toast } from "@labshelf/core/dom";
import { ShareOpenInAnotherTabError } from "../pageShares";

const LOG_MODULE = "collab.resume";

const projectName = (project: SharedProject): string => project.settings.title ?? project.settings.id;

/** `join` asks for an invite. */
export function resumeReports(logger: ILogger, join: () => void): ResumeReports {
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
      // That tab runs the share, and this one takes it over once that tab closes.
      if (error instanceof ShareOpenInAnotherTabError) {
        void logger.log("INFO", LOG_MODULE, "A shared project runs in another tab; this tab waits for it", { folder: project.folder, shareId: error.shareId });
        return;
      }
      toast(`Could not reconnect the shared project "${projectName(project)}": ${errorMessage(error)}`, "error");
    },
  };
}
